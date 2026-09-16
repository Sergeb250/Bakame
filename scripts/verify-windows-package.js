const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'release/win-unpacked/resources/app.asar');
const files = new Set(asar.listPackage(archive).map(file => file.replaceAll('\\', '/')));
for (const file of [
  'bootstrap.js', 'main.js', 'preload.js', 'src/ui/protected-controls.js', 'src/ui/protected-controls.css', 'index.html', 'settings.html', 'chat.html', 'llm-response.html',
  'mini-overlay.html', 'src/ui/mini-overlay.js', 'src/ui/mini-overlay.css', 'src/managers/mini-overlay.js', 'src/ui/credits.css',
  'src/ui/response-window.js', 'src/ui/response-window.css', 'src/ui/response-markdown.css', 'src/ui/audio-capture.js', 'src/ui/pcm-worklet.js',
  'prompt-loader.js', 'src/core/skills.js', 'src/core/overlay-position.js', 'src/ui/main-window.js', 'src/ui/settings-window.js',
  ...require('../src/core/skills').skills.map(skill => `prompts/${skill.id}.md`),
  'node_modules/@google/genai/package.json', 'node_modules/marked/lib/marked.umd.js'
]) assert.ok(files.has('/' + file), `Missing packaged file: ${file}`);
assert.ok(![...files].some(file => /\/(?:tests|\.venv-whisper|\.whisper-models|release)\//.test(file)), 'build excludes tests, local runtimes, and model downloads');
assert.ok(fs.existsSync(path.join(root, 'release/win-unpacked/resources/service/bakame.Service.exe')));
assert.ok(fs.existsSync(path.join(archive + '.unpacked', 'scripts/whisper_runtime.py')));
// Detect stale output or ASAR offset corruption if a source changed during packaging.
for (const file of files) {
  const relative = file.slice(1);
  if (!/^(?:src\/.*\.(?:js|css)|[^/]+\.(?:js|html))$/.test(relative)) continue;
  assert.deepEqual(asar.extractFile(archive, path.normalize(relative)), fs.readFileSync(path.join(root, relative)), `Packaged source matches: ${relative}`);
}
assert.deepEqual(fs.readFileSync(path.join(root, 'release/win-unpacked/resources/service/bakame.Service.exe')),
  fs.readFileSync(path.join(root, 'build/windows-service/bakame.Service.exe')), 'Packaged service matches tested binary');
const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(metadata.main, 'bootstrap.js');
assert.equal(metadata.name, 'bakame');
assert.equal(metadata.version, '1.0.1');
assert.equal(metadata.repository.url, 'https://github.com/TechyCSR/OpenCluely');
assert.equal(metadata.author.name, 'Serge Benit');
assert.equal(metadata.author.url, 'https://github.com/Sergeb250');
// electron-builder strips npm's contributors field; retain both credits explicitly.
assert.equal(metadata.customizationCredit, require('../package.json').customizationCredit);
for (const file of ['NOTICE', 'LICENSE']) {
  // extraFiles ships these beside the executable, outside the ASAR archive.
  assert.deepEqual(fs.readFileSync(path.join(root, 'release/win-unpacked', file + '.txt')), fs.readFileSync(path.join(root, file)));
}
console.log('PASS: packaged application includes all skills, renderer assets, provider dependencies, and the Windows service');
