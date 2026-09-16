const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { promptLoader } = require('../prompt-loader');

const root = path.resolve(__dirname, '..');
const quietLogger = { createServiceLogger: () => new Proxy({}, { get: () => () => {} }) };

// Exercise real request builders with only logging and the network SDK replaced.
function loadModule(file, stubs) {
  const filename = path.join(root, file);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const source = fs.readFileSync(filename, 'utf8');
  const compile = vm.runInThisContext(`(function(require, module, exports, __filename, __dirname) {${source}\n})`, { filename });
  compile(id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id), module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const session = loadModule('src/managers/session.manager.js', { '../core/logger': quietLogger });
const llm = loadModule('src/services/llm.service.js', {
  '../core/logger': quietLogger,
  '../managers/session.manager': session,
  '@google/genai': { GoogleGenAI: class {} }
});
llm.isInitialized = true;

test('all seven skills have their own prompts and coding requirements', () => {
  assert.deepEqual(promptLoader.getAvailableSkills(), ['general', 'interview', 'exam', 'programming', 'writing', 'research', 'dsa']);
  assert.equal(new Set(promptLoader.getSkillCatalog().map(skill => promptLoader.getSkillPrompt(skill.id))).size, 7);
  assert.equal(promptLoader.getSkillPrompt('coding'), promptLoader.getSkillPrompt('programming'));
  assert.equal(promptLoader.getSkillPrompt('unknown'), null);
  for (const id of ['general', 'interview', 'exam', 'writing', 'research']) {
    assert.equal(promptLoader.requiresProgrammingLanguage(id), false);
    assert.equal(promptLoader.getSkillPrompt(id, 'cpp'), promptLoader.getSkillPrompt(id));
  }
  assert.match(promptLoader.getSkillPrompt('dsa', 'python'), /IMPLEMENTATION LANGUAGE: PYTHON/);
  assert.match(promptLoader.getSkillPrompt('programming', 'python'), /PREFERRED PROGRAMMING LANGUAGE: PYTHON/);
  assert.equal(promptLoader.getSkillPrompt('dsa', 'auto'), promptLoader.getSkillPrompt('dsa'));
});

for (const skill of promptLoader.getSkillCatalog()) {
  test(`${skill.name}: text, voice, and screenshot requests use the selected prompt`, async () => {
    session.clear();
    session.setActiveSkill(skill.id);
    const language = skill.requiresProgrammingLanguage ? 'python' : null;
    const expectedPrompt = promptLoader.getSkillPrompt(skill.id, language);
    const captured = [];
    llm.executeStreamingRequest = async (request, onDelta) => {
      captured.push(request);
      onDelta('An answer');
      return 'An answer';
    };
    llm.executeAlternativeRequest = async request => {
      captured.push(request);
      return 'An answer';
    };
    llm.executeRequest = llm.executeAlternativeRequest;
    const input = 'Help me with this task';
    session.addUserInput(input);
    const results = [
      await llm.processTextWithSkillStream(input, skill.id, [], language),
      await llm.processTranscriptionWithIntelligentResponseStream(input, skill.id, [], language),
      await llm.processImageWithSkillStream(Buffer.from('image'), 'image/png', skill.id, [], language),
      await llm.processTextWithSkill(input, skill.id, [], language),
      await llm.processTranscriptionWithIntelligentResponse(input, skill.id, [], language),
      await llm.processImageWithSkill(Buffer.from('image'), 'image/png', skill.id, [], language)
    ];
    assert.equal(captured.length, 6);
    for (const request of captured) {
      assert.ok(request.systemInstruction.parts[0].text.startsWith(expectedPrompt));
      assert.doesNotMatch(request.systemInstruction.parts[0].text, /Ask your question relevant to/);
    }
    assert.equal(captured[0].contents.length, 1, 'current typed message is not duplicated');
    assert.equal(captured[1].contents.length, 1, 'current voice message is not duplicated');
    assert.ok(captured[2].contents[0].parts[1].inlineData.data);
    if (skill.id === 'exam') {
      for (const request of [captured[2], captured[5]]) {
        assert.match(request.contents[0].parts[0].text, /Identify every question and subpart/);
        assert.doesNotMatch(request.contents[0].parts[0].text, /summarize what is shown/);
      }
    }
    if (!skill.requiresProgrammingLanguage) {
      assert.doesNotMatch(captured[2].contents[0].parts[0].text, /final code|algorithm problem/);
    }
    for (const result of results) {
      assert.equal(result.metadata.skill, skill.id);
      assert.equal(result.response, 'An answer');
    }
  });
}

test('switching skills isolates model context and preserves it when switching back', () => {
  session.clear();
  session.setActiveSkill('dsa');
  session.addUserInput('Solve binary search');
  session.addModelResponse('DSA answer');
  session.setActiveSkill('writing');
  session.addUserInput('Draft an email');
  const request = llm.buildGeminiRequest('Draft an email', 'writing', [], null);
  assert.doesNotMatch(JSON.stringify(request.contents), /binary search|DSA answer/);
  session.addModelResponse('Late algorithm answer', { skill: 'dsa' });
  assert.ok(!session.getConversationHistory(20, 'writing').some(event => event.content === 'Late algorithm answer'));
  session.setActiveSkill('dsa');
  assert.ok(session.getConversationHistory().some(event => event.content === 'DSA answer'));
  assert.ok(session.getConversationHistory().some(event => event.content === 'Late algorithm answer'));
});

test('coding retains actual code language while DSA retains its language constraint', async () => {
  llm.executeStreamingRequest = async () => '```javascript\nconst answer = 42;\n```';
  const coding = await llm.processTextWithSkillStream('Explain this JavaScript', 'programming', [], 'cpp');
  assert.match(coding.response, /```javascript/);
  const dsa = await llm.processTextWithSkillStream('Solve it', 'dsa', [], 'python');
  assert.match(dsa.response, /```python/);
});

test('voice failures explain the provider failure instead of rejecting unrelated tasks', () => {
  const result = llm.generateIntelligentFallbackResponse('Draft an email', 'writing');
  assert.equal(result.metadata.usedFallback, true);
  assert.match(result.response, /AI provider/);
  assert.doesNotMatch(result.response, /relevant to|rephrase/);
});
