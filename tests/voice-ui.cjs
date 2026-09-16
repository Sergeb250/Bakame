const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ controller, speech, manager, windows, evaluate, waitFor, delay, testDir }) => {
  const broadcast = (channel, data) => manager.broadcastToAllWindows(channel, data);
  const visibleAnswer = () => evaluate('llmResponse', "document.querySelector('.conversation-turn:last-child .assistant-response')?.textContent");
  broadcast('transcription-llm-response-start', { messageId: 'live-test' });
  broadcast('transcription-llm-response-chunk', { messageId: 'live-test', delta: 'The first words' });
  await waitFor(async () => (await visibleAnswer()) === 'The first words', 'overlay displays partial answer');
  await waitFor(() => evaluate('llmResponse', "document.querySelector('[data-message-id=live-test] .assistant-response').textContent === 'The first words'"), 'chat displays partial answer');
  broadcast('transcription-llm-response-chunk', { messageId: 'live-test', delta: ' arrive immediately.' });
  broadcast('transcription-llm-response', { messageId: 'live-test', response: 'The **complete** answer.' });
  broadcast('transcription-llm-response', { messageId: 'live-test', response: 'The **complete** answer.' });
  await waitFor(() => evaluate('llmResponse', "document.querySelector('[data-message-id=live-test] strong')?.textContent === 'complete'"), 'final markdown');
  assert.equal(await evaluate('llmResponse', "document.querySelectorAll('[data-message-id=live-test]').length"), 1);
  broadcast('transcription-llm-response-start', { messageId: 'newer-test' });
  broadcast('transcription-llm-response-chunk', { messageId: 'newer-test', delta: 'New answer' });
  broadcast('transcription-llm-response', { messageId: 'live-test', response: 'Old answer' });
  broadcast('display-llm-response', { response: 'Old answer', metadata: { messageId: 'live-test' } });
  await waitFor(async () => (await visibleAnswer()) === 'New answer', 'late answer cannot replace newer stream');
  broadcast('transcription-llm-response-error', { messageId: 'newer-test', error: 'Provider disconnected' });
  await waitFor(() => evaluate('llmResponse', "document.querySelector('[data-message-id=newer-test] .assistant-response').textContent === 'Provider disconnected'"), 'stream error');
  console.log('PASS: live chunks in the unified conversation, one final bubble, formatted final, late response isolation, visible provider failure');

  broadcast('interim-transcription', { text: 'What is a process' });
  await waitFor(() => evaluate('llmResponse', "document.getElementById('interimOverlay').textContent.includes('What is a process')"), 'live transcript');
  broadcast('interim-transcription', { text: '' });
  await waitFor(() => evaluate('llmResponse', "document.getElementById('interimOverlay').hidden"), 'partial transcript cleared');
  broadcast('speech-status', { status: 'Recording stopped', isRecording: false });
  await waitFor(() => evaluate('llmResponse', "document.getElementById('voiceStatusText').textContent === 'Recording stopped'"), 'stopped status');

  const saved = await evaluate('settings', "window.electronAPI.saveSettings({whisperAudioSource:'both', whisperCaptureMode:'vad'})");
  assert.equal(saved.success, true);
  assert.match(fs.readFileSync(path.join(testDir, '.env'), 'utf8'), /WHISPER_AUDIO_SOURCE=both/);
  speech.isRecording = true;
  const blocked = await evaluate('settings', "window.electronAPI.saveSettings({whisperAudioSource:'microphone'})");
  assert.equal(blocked.success, false);
  assert.equal(speech.getAudioSource(), 'both');
  speech.isRecording = false;
  console.log('PASS: interim speech, accurate stop status, persisted input source, audio settings cannot reset active capture');

  // Real AudioContexts + AudioWorklet + preload IPC, fed by generated tones.
  // This automated test never opens a real microphone or plays captured audio.
  await evaluate('main', `(() => {
    window.testToneContext = new AudioContext();
    window.testToneStreams = [];
    window.originalDisplayCapture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    window.originalMicCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const makeStream = async () => {
      const oscillator = testToneContext.createOscillator();
      const gain = testToneContext.createGain(); gain.gain.value = 0.1;
      const destination = testToneContext.createMediaStreamDestination();
      oscillator.connect(gain).connect(destination); oscillator.start();
      testToneStreams.push(destination.stream);
      await testToneContext.resume();
      return destination.stream;
    };
    navigator.mediaDevices.getDisplayMedia = makeStream;
    navigator.mediaDevices.getUserMedia = makeStream;
  })()`);
  const started = speech.startRecording();
  assert.equal(started.success, true);
  await waitFor(() => speech.chunks.length >= 3, 'PCM chunks through real worklet and IPC');
  assert.ok(speech.chunks.every(buffer => buffer.length === 3200));
  assert.ok(speech.chunks.some(buffer => buffer.some(byte => byte !== 0)));
  assert.equal(await evaluate('main', 'testToneStreams.length'), 2);
  await waitFor(() => evaluate('llmResponse', "document.getElementById('voiceLevel').value > 0"), 'input meter');
  const beforeCollapse = speech.chunks.length;
  assert.equal((await evaluate('llmResponse', 'window.electronAPI.minimizeToDot()')).success, true);
  await waitFor(() => speech.chunks.length >= beforeCollapse + 2, 'audio keeps flowing while collapsed');
  assert.equal(speech.isRecording, true);
  assert.equal(windows.get('main').isVisible(), false);
  assert.equal(windows.get('llmResponse').isVisible(), false);
  await evaluate('mini', 'window.electronAPI.restoreFromDot()');
  for (const window of windows.values()) window.hide();
  await controller.stopSpeechRecognition();
  await waitFor(() => evaluate('main', 'window.mainWindowUI.audioCapture.resources === null'), 'capture disposed');
  assert.equal(await evaluate('main', "testToneStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), true);
  console.log('PASS: both sources mix into 16 kHz PCM through actual AudioWorklet and Electron IPC, keep recording while collapsed, and stop releases every track');

  speech.provider = 'azure';
  speech.chunks = [];
  await evaluate('main', 'void (testToneStreams.length = 0)');
  await evaluate('llmResponse', "document.getElementById('listenButton').click()");
  await waitFor(() => speech.chunks.length >= 3, 'Azure mixed PCM through real worklet and IPC');
  assert.equal(await evaluate('main', 'testToneStreams.length'), 2, 'Azure mixes microphone and computer audio');
  assert.ok(speech.chunks.every(buffer => buffer.length === 3200));
  assert.ok(speech.chunks.some(buffer => buffer.some(byte => byte !== 0)));
  await controller.stopSpeechRecognition();
  await waitFor(() => evaluate('main', 'window.mainWindowUI.audioCapture.resources === null'), 'Azure capture disposed');
  assert.equal(await evaluate('main', "testToneStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))"), true);
  speech.provider = 'whisper';
  await evaluate('main', 'testToneContext.close()');
  console.log('PASS: Azure Listen starts mixed capture through the real UI/IPC and releases its tracks on stop');

  if (process.env.OPENCLUELY_TEST_LOOPBACK === '1' && process.platform === 'win32') {
    controller.saveSettings({ whisperAudioSource: 'system' });
    controller.setupPermissions();
    await evaluate('main', 'void (navigator.mediaDevices.getDisplayMedia = window.originalDisplayCapture)');
    speech.chunks = [];
    speech.startRecording();
    try {
      await waitFor(() => evaluate('main', "window.mainWindowUI.audioCapture.resources?.streams[0]?.getAudioTracks().length === 1"), 'Windows loopback audio track', 20000);
    } catch (error) {
      console.log(await evaluate('llmResponse', "document.getElementById('voiceStatusText').textContent"));
      throw error;
    }
    await waitFor(() => speech.chunks.length > 0, 'Windows loopback PCM');
    await controller.stopSpeechRecognition();
    speech.chunks = []; // Discard the brief capture; no recording is written.
    console.log('PASS: real Windows system-audio capture starts and stops using Electron loopback');
  }

  await evaluate('main', "void (navigator.mediaDevices.getUserMedia = async () => { throw new Error('Test device unavailable'); })");
  controller.saveSettings({ whisperAudioSource: 'microphone' });
  for (const provider of ['whisper', 'azure']) {
    speech.provider = provider;
    speech.startRecording();
    await waitFor(() => !speech.isRecording, `${provider}: failed capture stops recognition`);
    await waitFor(() => evaluate('llmResponse', "document.getElementById('voiceStatusText').textContent.includes('Test device unavailable')"), 'capture error visible');
    speech.emit('status', 'Recording stopped');
    await delay(100);
    assert.equal(await evaluate('llmResponse', "document.getElementById('voiceStatusText').textContent.includes('Test device unavailable')"), true);
  }
  speech.provider = 'whisper';
  console.log('PASS: audio-device failure stops capture and explains the error');
  const setupCalls = [];
  controller._whisperInstaller = {
    detect: async () => ({ found: true, optimized: false, command: '' }),
    install: async () => { setupCalls.push('install'); return { ok: true, command: '' }; },
    downloadModel: async model => { setupCalls.push(model); return { ok: true }; }
  };
  await evaluate('settings', "document.getElementById('setupWhisper').click()");
  await waitFor(() => evaluate('settings', "document.getElementById('whisperSetupStatus').textContent.includes('Whisper is ready') && !document.getElementById('setupWhisper').disabled"), 'voice setup completion');
  assert.deepEqual(setupCalls, ['install', 'base']);
  speech.isProcessingAudio = true;
  await evaluate('settings', "document.getElementById('setupWhisper').click()");
  await waitFor(() => evaluate('settings', "document.getElementById('whisperSetupStatus').textContent.includes('wait for transcription')"), 'setup does not run during pending transcription');
  speech.isProcessingAudio = false;
  assert.equal(setupCalls.length, 2);
  console.log('PASS: setup upgrades an existing runtime, prepares selected model, and prevents setup while speech is processing');
  await delay(200);
  await evaluate('settings', "document.getElementById('whisperAudioSource').scrollIntoView({block:'center'})");
  for (const name of ['llmResponse', 'settings']) {
    // Resizing requests a fresh paint even when the test window stays hidden.
    const [width, height] = windows.get(name).getSize();
    windows.get(name).setSize(width, height + 1);
    await delay(100);
    const image = await windows.get(name).webContents.capturePage();
    fs.writeFileSync(path.join(testDir, `${name}-voice.png`), image.toPNG());
  }
};
