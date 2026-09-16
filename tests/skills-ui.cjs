const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const testDir = process.env.OPENCLUELY_TEST_DIR;
if (!testDir) throw new Error('Run npm run test:skills-ui');
app.setPath('userData', testDir);
app.disableHardwareAcceleration();
const root = process.env.OPENCLUELY_APP_ROOT || path.resolve(__dirname, '..');
const appRequire = require('node:module').createRequire(path.join(root, 'main.js'));
const loadApp = file => appRequire(file.replace(/^\.\.\//, './'));
const windows = new Map();
const requests = [];
const uiErrors = [];
const quiet = new Proxy({}, { get: () => () => {} });
function stub(file, exports) {
  const resolved = appRequire.resolve(file.replace(/^\.\.\//, './'));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('../src/core/logger', { createServiceLogger: () => quiet });
const speech = Object.assign(new EventEmitter(), {
  provider: 'whisper', isAvailable: () => true, isManualCaptureMode: () => false,
  captureId: 0, isRecording: false, isProcessingAudio: false, chunks: [],
  getAudioSource() { return process.env.WHISPER_AUDIO_SOURCE || 'both'; },
  getCaptureConfig() { return { captureId: this.captureId, provider: this.provider,
    isRecording: this.isRecording, isProcessingAudio: this.isProcessingAudio,
    useRendererCapture: true, audioSource: this.getAudioSource(), systemAudioSupported: process.platform === 'win32' }; },
  getStatus() { return { isRecording: this.isRecording, isProcessingAudio: this.isProcessingAudio }; },
  startRecording() {
    this.isRecording = true; this.captureId++; this.emit('recording-started');
    this.emit('status', 'Listening'); return { success: true };
  },
  stopRecording() { this.isRecording = false; this.emit('recording-stopped'); this.emit('status', 'Recording stopped'); },
  handleAudioChunkFromRenderer(buffer) { if (this.isRecording) this.chunks.push(Buffer.from(buffer)); }
});
stub('../src/services/speech.service', speech);
stub('../src/services/capture.service', {
  captureAndProcess: async () => ({ imageBuffer: Buffer.from('test image'), mimeType: 'image/png' })
});
const actualWindowManager = loadApp('../src/managers/window.manager');
actualWindowManager.windows = windows;
const manager = {
  windows,
  miniOverlay: actualWindowManager.miniOverlay,
  windowGap: 10,
  isInteractive: true,
  getWindow: name => windows.get(name === 'chat' ? 'llmResponse' : name),
  getWindowStats: () => ({ isInteractive: true, windows: {} }),
  broadcastToAllWindows: (channel, data) => {
    for (const window of windows.values()) window.webContents.send(channel, data);
  },
  showLLMLoading() {}, hideLLMResponse() {}, expandLLMWindow() {},
  positionBoundWindows: () => actualWindowManager.positionBoundWindows(),
  moveBoundWindows: (x, y) => actualWindowManager.moveBoundWindows(x, y),
  setWindowGap(gap) { this.windowGap = gap; },
  handleRecordingStarted(data) { this.broadcastToAllWindows('recording-started', data); },
  handleRecordingStopped() { this.broadcastToAllWindows('recording-stopped'); },
  showLLMResponse(response, metadata) {
    windows.get('llmResponse')?.webContents.send('display-llm-response', { response, metadata });
  }
};
stub('../src/managers/window.manager', manager);
const { ApplicationController } = loadApp('../main');
// Use real IPC and renderers, without global shortcuts, capture watchers, or
// microphone access. The real application lifecycle is checked separately.
ApplicationController.prototype.onAppReady = async () => {};
ApplicationController.prototype.onWindowAllClosed = () => {};
ApplicationController.prototype.onWillQuit = () => {};
const controller = new ApplicationController();
controller.isReady = true;
const session = loadApp('../src/managers/session.manager');
const llm = loadApp('../src/services/llm.service');
llm.isInitialized = true;
llm.executeStreamingRequest = async (request, onDelta) => {
  requests.push(request);
  const response = 'A useful answer for this task.';
  if (onDelta) onDelta(response);
  return response;
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(30);
  }
}
async function evaluate(name, expression) {
  return windows.get(name).webContents.executeJavaScript(expression);
}
async function select(name, skill) {
  await evaluate(name, `(() => {
    document.getElementById('activeSkill-control').click();
    document.querySelector('#activeSkill-options [data-value=' + ${JSON.stringify(skill)} + ']').click();
  })()`);
  await waitFor(async () => controller.activeSkill === skill &&
    await evaluate('main', `document.getElementById('activeSkill').value === ${JSON.stringify(skill)}`) &&
    await evaluate('settings', `document.getElementById('activeSkill').value === ${JSON.stringify(skill)}`), `select ${skill}`);
}

app.whenReady().then(async () => {
  try {
    if (process.env.OPENCLUELY_TEST_PHASE === 'restart') {
      assert.equal(controller.activeSkill, 'exam');
      assert.equal(controller.codingLanguage, 'auto');
      assert.equal(session.currentSkill, 'exam');
      console.log('PASS: selected skill and language restored in a new Electron process');
      return;
    }
    for (const [name, file, width, height] of [
      ['main', 'index.html', 700, 100],
      ['settings', 'settings.html', 400, 380],
      ['llmResponse', 'llm-response.html', 840, 480]
    ]) {
      actualWindowManager.windowConfigs[name] = { ...actualWindowManager.windowConfigs[name], file: path.join(root, file), width, height };
      const window = await actualWindowManager.createWindow(name, false);
      windows.set(name, window);
      window.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3 && !message.includes('ERR_FILE_NOT_FOUND')) uiErrors.push(`${name}: ${message}`);
      });

    }
    await waitFor(() => evaluate('main', "!document.getElementById('activeSkill').disabled"), 'toolbar ready');
    await waitFor(() => evaluate('settings', "!document.getElementById('activeSkill').disabled"), 'settings ready');
    await waitFor(() => evaluate('llmResponse', "document.getElementById('activeSkill').options.length === 7"), 'conversation ready');
    assert.equal(windows.size, 3, 'one conversation window, toolbar and settings');
    assert.equal(await actualWindowManager.createChatWindow(), windows.get('llmResponse'));
    actualWindowManager.windowConfigs.mini.file = path.join(root, 'mini-overlay.html');
    const activated = [];
    manager.showOnCurrentDesktop = window => activated.push(window.id);
    manager.showAllWindows = () => { throw new Error('Repeated launch must not open every panel'); };
    controller.handleSecondInstance();
    assert.deepEqual(activated, [windows.get('main').id], 'repeated launch activates only the toolbar');
    if (process.env.OPENCLUELY_TEST_PHASE === 'privacy') {
      await require('./privacy-ui.cjs')({ windows, evaluate, waitFor, delay, testDir, root, controller, actualWindowManager });
      assert.deepEqual(uiErrors, [], 'renderer errors');
      return;
    }
    if (process.env.OPENCLUELY_TEST_PHASE === 'voice') {
      await require('./assistant-ui.cjs')({ controller, manager, windows, evaluate, waitFor, delay, testDir });
      await require('./voice-ui.cjs')({ controller, speech, manager, windows, evaluate, waitFor, delay, testDir });
      assert.deepEqual(uiErrors, [], 'renderer errors');
      return;
    }
    if (process.env.OPENCLUELY_TEST_PHASE === 'mini') {
      actualWindowManager.windowConfigs.mini.file = path.join(root, 'mini-overlay.html');
      await require('./mini-ui.cjs')({ actualWindowManager, manager, windows, controller, evaluate, waitFor, delay, testDir });
      assert.deepEqual(uiErrors, [], 'renderer errors');
      return;
    }
    const catalog = controller.getSettings().availableSkills;
    for (const skill of catalog) {
      await select('main', skill.id);
      assert.equal(session.currentSkill, skill.id);
      assert.equal(await evaluate('main', "getComputedStyle(document.getElementById('languageSelector')).display !== 'none'"), skill.requiresProgrammingLanguage);
      assert.equal(await evaluate('settings', "getComputedStyle(document.getElementById('codingLanguageSetting')).display !== 'none'"), skill.requiresProgrammingLanguage);
      await waitFor(() => evaluate('llmResponse', `document.getElementById('activeSkill').value === ${JSON.stringify(skill.id)}`), 'conversation mode');
      await controller.processWithLLM('Help with this task', session.getOptimizedHistory());
      await controller.processTranscriptionWithLLM('Help with this task', session.getOptimizedHistory());
      await controller.triggerScreenshotOCR();
      const expected = loadApp('../prompt-loader').promptLoader.getSkillPrompt(skill.id, skill.requiresProgrammingLanguage ? controller.codingLanguage : null);
      for (const request of requests.slice(-3)) assert.ok(request.systemInstruction.parts[0].text.startsWith(expected));
    }
    console.log('PASS: seven toolbar modes, synchronized settings/chat, language visibility, and all three request paths');

    assert.equal(controller.navigateSkill(1).skill, 'general');
    assert.equal(controller.navigateSkill(-1).skill, 'dsa');
    await select('settings', 'research');
    const invalid = await evaluate('main', "window.electronAPI.updateActiveSkill('missing-mode')");
    assert.equal(invalid.success, false);
    assert.equal(controller.activeSkill, 'research');
    await select('settings', 'writing');
    assert.equal(controller.saveSettings({ activeSkill: 'general' }).success, true);
    await waitFor(() => evaluate('settings', "document.getElementById('activeSkill').value === 'general'"), 'save-settings mode sync');
    await select('settings', 'writing');
    controller.saveSettings({ codingLanguage: 'auto' });
    assert.match(fs.readFileSync(path.join(testDir, '.env'), 'utf8'), /ACTIVE_SKILL=writing/);
    assert.match(fs.readFileSync(path.join(testDir, '.env'), 'utf8'), /CODING_LANGUAGE=auto/);
    console.log('PASS: settings selection, keyboard wraparound, validation, and persisted preferences');

    let finish;
    llm.executeStreamingRequest = () => new Promise(resolve => { finish = resolve; });
    const pending = controller.processWithLLM('Write a note', session.getOptimizedHistory());
    controller.setActiveSkill('dsa');
    finish('A late writing answer');
    await pending;
    assert.ok(session.getConversationHistory(20, 'writing').some(event => event.content === 'A late writing answer'));
    assert.ok(!session.getConversationHistory(20, 'dsa').some(event => event.content === 'A late writing answer'));
    console.log('PASS: replies arriving after a mode change stay in the originating skill');

    const voiceRequests = [];
    const completions = [];
    llm.executeStreamingRequest = request => {
      voiceRequests.push(request);
      return new Promise(resolve => completions.push(resolve));
    };
    controller.setActiveSkill('general');
    controller.handleTranscriptionFragment('Plan my day');
    controller.setActiveSkill('writing');
    controller.handleTranscriptionFragment('Draft an email');
    controller.setActiveSkill('research');
    controller.handleTranscriptionFragment('Compare these options');
    for (const [index, skill] of ['general', 'writing', 'research'].entries()) {
      await waitFor(() => completions.length > index, `buffered ${skill} speech`);
      const prompt = loadApp('../prompt-loader').promptLoader.getSkillPrompt(skill);
      assert.ok(voiceRequests[index].systemInstruction.parts[0].text.startsWith(prompt));
      completions[index](`Answer for ${skill}`);
    }
    await waitFor(() => !controller._utteranceDispatchInFlight, 'voice queue drained');
    clearTimeout(controller._utteranceTimer);
    for (const skill of ['general', 'writing', 'research']) {
      assert.ok(session.getConversationHistory(20, skill).some(event => event.content === `Answer for ${skill}`));
    }
    console.log('PASS: buffered speech keeps its original mode through successive switches');

    controller.setActiveSkill('writing');
    fs.mkdirSync(path.join(testDir, '.env.tmp'));
    try {
      await evaluate('settings', "(() => { const select = document.getElementById('activeSkill'); select.value = 'general'; select.dispatchEvent(new Event('change')); })()");
      await waitFor(() => evaluate('settings', "!!document.getElementById('skillError').textContent && document.getElementById('activeSkill').value === 'writing'"), 'failed save rolls back selector');
      assert.equal(controller.activeSkill, 'writing');
      assert.equal(session.currentSkill, 'writing');
      assert.equal(process.env.ACTIVE_SKILL, 'writing');
    } finally {
      fs.rmdirSync(path.join(testDir, '.env.tmp'));
    }
    await select('settings', 'writing');
    console.log('PASS: failed persistence leaves the active mode unchanged and shows an error');
    await select('settings', 'interview');
    await waitFor(() => evaluate('settings', "document.getElementById('activeSkill-control').textContent.includes('Interview') && document.getElementById('skillDescription').textContent.includes('Short, precise') && !document.getElementById('skillError').textContent"), 'Interview label and description');
    await select('settings', 'exam');
    await waitFor(() => evaluate('settings', "document.getElementById('activeSkill-control').textContent.includes('Exam') && document.getElementById('skillDescription').textContent.includes('Identify questions')"), 'Exam label and description');
    await require('./window-position-ui.cjs')({ windows, evaluate, waitFor, delay, actualWindowManager, controller });
    await delay(250);
    for (const name of ['main', 'settings', 'llmResponse']) {
      // Request a fresh paint for these hidden test windows before capturing.
      const [width, height] = windows.get(name).getSize();
      windows.get(name).setSize(width, height + 1);
      await delay(100);
      const image = await windows.get(name).webContents.capturePage();
      fs.writeFileSync(path.join(testDir, `${name}.png`), image.toPNG());
    }
    assert.deepEqual(uiErrors, [], 'renderer errors');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    actualWindowManager.miniOverlay.minimized = false;
    for (const window of windows.values()) window.destroy();
    app.exit(process.exitCode || 0);
  }
});
