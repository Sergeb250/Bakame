const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const Queue = require('../src/services/transcription-queue');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('final speech is immutable, ordered, and fully drained before stop completes', async () => {
  const gate = deferred();
  const seen = [], transcripts = [];
  const queue = new Queue(async buffer => {
    seen.push(buffer.toString());
    if (seen.length === 1) await gate.promise;
    return buffer.toString();
  });
  queue.on('transcription', text => transcripts.push(text));
  const first = Buffer.from('first');
  queue.enqueue(first, 1);
  first.fill(0);
  await tick();
  queue.enqueue(Buffer.from('second'), 2);
  let drained = false;
  const stopped = queue.drain().then(() => { drained = true; });
  await tick();
  assert.equal(drained, false);
  gate.resolve();
  await stopped;
  assert.deepEqual(seen, ['first', 'second']);
  assert.deepEqual(transcripts, seen);
  assert.equal(queue.pendingBytes, 0);
});

test('final utterances overtake queued previews and suppress an obsolete in-flight preview', async () => {
  const gate = deferred();
  const jobs = [], partials = [], finals = [];
  const queue = new Queue(async (buffer, options) => {
    jobs.push([buffer.toString(), options.preview]);
    if (jobs.length === 1) await gate.promise;
    return buffer.toString();
  });
  queue.on('partial', text => partials.push(text));
  queue.on('transcription', text => finals.push(text));
  queue.previewLatest(Buffer.from('unfinished'), 1);
  await tick();
  queue.previewLatest(Buffer.from('almost done'), 1);
  queue.enqueue(Buffer.from('complete question'), 1);
  gate.resolve();
  await queue.drain();
  assert.deepEqual(jobs, [['unfinished', true], ['complete question', false]]);
  assert.deepEqual(partials, []);
  assert.deepEqual(finals, ['complete question']);
});

test('only the newest pending preview is transcribed; failures do not lose later utterances', async () => {
  const gate = deferred();
  const seen = [], errors = [];
  const queue = new Queue(async buffer => {
    seen.push(buffer.toString());
    if (seen.length === 1) await gate.promise;
    if (buffer.toString() === 'fail') throw Error('inference failure');
    return buffer.toString();
  });
  queue.on('failure', error => errors.push(error.message));
  queue.previewLatest(Buffer.from('one'), 1);
  await tick();
  queue.previewLatest(Buffer.from('two'), 1);
  queue.previewLatest(Buffer.from('three'), 1);
  gate.resolve();
  await queue.running;
  assert.deepEqual(seen, ['one', 'three']);
  queue.enqueue(Buffer.from('fail'), 1);
  queue.enqueue(Buffer.from('next'), 2);
  await queue.drain();
  assert.deepEqual(errors, ['inference failure']);
  assert.equal(seen.at(-1), 'next');
  assert.equal(queue.pendingBytes, 0);
});

for (const rate of [16000, 44100, 48000]) {
  test(`AudioWorklet resamples ${rate} Hz stereo to exact 16 kHz mono PCM with input levels`, () => {
    const messages = [];
    let Processor;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ui/pcm-worklet.js'), 'utf8'), {
      sampleRate: rate, Int16Array,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => messages.push(m) }; } },
      registerProcessor: (_name, value) => { Processor = value; }
    });
    const processor = new Processor();
    // Exactly one second; opposite channels downmix to amplitude 0.25.
    for (let offset = 0; offset < rate; offset += 128) {
      const size = Math.min(128, rate - offset);
      processor.process([[new Float32Array(size).fill(0.75), new Float32Array(size).fill(-0.25)]]);
    }
    processor.port.onmessage({ data: { type: 'flush' } });
    const audio = messages.filter(m => m.type === 'audio');
    const samples = audio.flatMap(m => Array.from(new Int16Array(m.buffer)));
    assert.equal(samples.length, 16000);
    assert.ok(samples.every(value => value === 8191));
    assert.ok(audio.every(m => Math.abs(m.level - 0.25) < 1e-6));
    assert.equal(messages.at(-1).type, 'flushed');
  });
}

function captureClass() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/ui/audio-capture.js'), 'utf8'), {
    window, navigator: {}, setTimeout, clearTimeout
  });
  return window.LiveAudioCapture;
}
function track() { return { stopped: false, stop() { this.stopped = true; } }; }
function mediaStream(audio = [track()], video = []) {
  return { getTracks: () => [...audio, ...video], getAudioTracks: () => audio, getVideoTracks: () => video };
}

test('stopping during a pending microphone permission request disposes the late stream', async () => {
  const gate = deferred(), stream = mediaStream(), errors = [];
  const Capture = captureClass();
  const capture = new Capture({ mediaDevices: { getUserMedia: () => gate.promise }, onError: e => errors.push(e) });
  const started = capture.start({ audioSource: 'microphone', captureId: 1 });
  await tick();
  await capture.stop();
  gate.resolve(stream);
  assert.equal(await started, false);
  assert.ok(stream.getTracks().every(t => t.stopped));
  assert.deepEqual(errors, []);
  assert.equal(capture.resources, null);
});

test('system capture without audio fails visibly and releases its video track', async () => {
  const video = track(), errors = [];
  const Capture = captureClass();
  const capture = new Capture({
    mediaDevices: { getDisplayMedia: async () => mediaStream([], [video]) },
    onError: e => errors.push(e)
  });
  assert.equal(await capture.start({ audioSource: 'system', systemAudioSupported: true, captureId: 1 }), false);
  assert.match(errors[0], /No audio track/);
  assert.equal(video.stopped, true);
});

function speechClass(platform = 'win32', stubs = {}) {
  const filename = path.resolve(__dirname, '../src/services/speech.service.js');
  const realRequire = createRequire(filename);
  const quiet = new Proxy({}, { get: () => () => {} });
  const context = { module: { exports: {} }, __dirname: path.dirname(filename), Buffer, window: {}, global: {},
    process: { platform, env: {} }, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate,
    require: name => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name === '../core/logger') return { createServiceLogger: () => quiet };
      if (name === '../core/config') return { get: () => undefined };
      if (name === 'microsoft-cognitiveservices-speech-sdk' || name === 'node-record-lpcm16') return {};
      if (name === './whisper-worker.service') return class {
        isConfigured() { return false; } setKeepWarm(value) { this.keepWarm = value; }
        releaseWhenIdle() {} close() {}
      };
      return realRequire(name);
    }
  };
  // Load the real class without probing installed CLI tools in unit tests.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8').replace('module.exports = new SpeechService();', 'module.exports = SpeechService;'), context, { filename });
  const Speech = context.module.exports;
  Speech.prototype.initializeClient = function () { this.available = true; this.provider = 'whisper'; };
  return Speech;
}
function pcm(amplitude, ms = 100) {
  const result = Buffer.alloc(ms * 32);
  for (let i = 0; i < result.length; i += 2) result.writeInt16LE(Math.round(amplitude * 32767), i);
  return result;
}

test('VAD ignores silence, finalizes on a pause, and stop retains speech captured during inference', async () => {
  const Speech = speechClass();
  const speech = new Speech();
  const first = deferred(), second = deferred(), calls = [], results = [];
  speech._transcribeWhisperBuffer = async buffer => {
    calls.push(buffer);
    await (calls.length === 1 ? first.promise : second.promise);
    return `question ${calls.length}`;
  };
  speech.on('error', error => assert.fail(error));
  speech.on('transcription', text => results.push(text));
  assert.equal(speech.startRecording().success, true);
  for (let i = 0; i < 10; i++) speech.handleAudioChunkFromRenderer(pcm(0));
  assert.equal(speech.segmentBytes, 0);
  for (let i = 0; i < 6; i++) speech.handleAudioChunkFromRenderer(pcm(0.25));
  for (let i = 0; i < 8; i++) speech.handleAudioChunkFromRenderer(pcm(0));
  await tick();
  assert.equal(calls.length, 1);
  for (let i = 0; i < 6; i++) speech.handleAudioChunkFromRenderer(pcm(0.3));
  const stopped = speech.stopRecording();
  assert.equal(speech.isProcessingAudio, true);
  assert.equal(speech.startRecording().success, false);
  first.resolve();
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(speech.isProcessingAudio, true);
  second.resolve();
  await stopped;
  assert.equal(results.length, 2);
  assert.equal(speech.isRecording, false);
  assert.equal(speech.isProcessingAudio, false);
  assert.equal(speech.segmentBytes, 0);
  assert.equal(speech.whisperWorker.keepWarm, false);
});

test('unsupported loopback platforms use microphone capture', () => {
  const Speech = speechClass('darwin');
  assert.equal(new Speech().getAudioSource(), 'microphone');
});

function azureFixture(platform = 'win32', { startupError, configurationError, deferredStop } = {}) {
  const streams = [], recognizers = [];
  const sdk = {
    SpeechConfig: { fromSubscription: () => ({ setProperty() {} }) },
    OutputFormat: { Detailed: 1 }, PropertyId: {},
    AudioInputStream: { createPushStream() {
      const stream = { chunks: [], closed: false, write(chunk) { this.chunks.push(chunk); }, close() { this.closed = true; } };
      streams.push(stream);
      return stream;
    } },
    AudioConfig: { fromStreamInput: () => ({ close() {} }) },
    SpeechRecognizer: class {
      constructor() {
        if (configurationError) throw Error(configurationError);
        recognizers.push(this);
      }
      startContinuousRecognitionAsync(success, failure) {
        this.failStart = failure;
        if (startupError) failure(startupError); else success();
      }
      stopContinuousRecognitionAsync(success) { this.finishStop = success; if (!deferredStop) success(); }
      close() { this.closed = true; }
    }
  };
  const Speech = speechClass(platform, { 'microsoft-cognitiveservices-speech-sdk': sdk });
  const speech = new Speech();
  speech.provider = 'azure';
  speech.runtimeSettings = { azureKey: 'test-key', azureRegion: 'test-region' };
  speech._initializeAzureClient();
  speech._audioProgramExists = () => assert.fail('Windows/macOS must never probe for SoX or arecord');
  speech._startMicrophoneCapture = () => assert.fail('Windows/macOS must use renderer capture');
  const errors = [];
  speech.on('error', error => errors.push(error));
  return { speech, streams, recognizers, errors };
}

test('Azure releases capture immediately, blocks restart while finishing, and ignores stale recognizer events', () => {
  const { speech, recognizers, errors } = azureFixture('win32', { deferredStop: true });
  let stops = 0;
  speech.on('recording-stopped', () => stops++);
  speech.startRecording();
  speech.stopRecording();
  assert.equal(stops, 1);
  assert.equal(speech.isRecording, false);
  assert.equal(speech.isProcessingAudio, true);
  assert.equal(speech.startRecording().success, false);
  recognizers[0].finishStop();
  assert.equal(speech.isProcessingAudio, false);
  assert.equal(speech.startRecording().success, true);
  recognizers[0].sessionStopped();
  recognizers[0].canceled(null, {});
  assert.equal(speech.isRecording, true);
  assert.deepEqual(errors, []);
  speech.stopRecording();
  recognizers[1].finishStop();
});

for (const platform of ['win32', 'darwin']) {
  test(`Azure on ${platform} captures without SoX, routes exact PCM, and releases resources on stop/restart`, () => {
    const { speech, streams, recognizers, errors } = azureFixture(platform);
    const captures = [];
    speech.on('recording-started', capture => {
      assert.ok(speech.pushStream, 'audio sink exists before renderer starts');
      captures.push(capture);
    });
    assert.equal(speech.isAvailable(), true, 'Azure initializes without a native recorder');
    assert.equal(speech.startRecording().success, true);
    assert.equal(captures[0].useRendererCapture, true);
    assert.equal(captures[0].audioSource, platform === 'win32' ? 'both' : 'microphone');
    assert.equal(captures[0].provider, 'azure');
    // A slice with bytes outside its bounds catches accidental Buffer pool leakage.
    const backing = Buffer.from([99, 99, 1, 2, 3, 4, 99, 99]);
    speech.handleAudioChunkFromRenderer(backing.subarray(2, 6));
    assert.ok(streams[0].chunks[0] instanceof ArrayBuffer);
    assert.deepEqual(Buffer.from(streams[0].chunks[0]), Buffer.from([1, 2, 3, 4]));
    speech.stopRecording();
    assert.equal(streams[0].closed, true);
    assert.equal(recognizers[0].closed, true);
    assert.equal(speech.recognitionStartTimer, null);
    assert.equal(speech.getCaptureConfig().useRendererCapture, false);
    speech.handleAudioChunkFromRenderer(backing);
    assert.equal(streams[0].chunks.length, 1, 'stopped capture cannot feed Azure');
    assert.equal(speech.startRecording().success, true);
    assert.ok(captures[1].captureId > captures[0].captureId);
    recognizers[0].failStart('stale callback');
    assert.equal(speech.isRecording, true, 'an old startup callback cannot stop a new capture');
    speech.stopRecording();
    assert.deepEqual(errors, []);
  });
}

for (const failure of [{ startupError: 'Test connection failed' }, { configurationError: 'Test audio config failed' }]) {
  test(`Azure startup failure releases capture and reports the error: ${Object.keys(failure)[0]}`, () => {
    const { speech, streams, errors } = azureFixture('win32', failure);
    let stops = 0;
    speech.on('recording-stopped', () => stops++);
    speech.startRecording();
    assert.equal(speech.isRecording, false);
    assert.equal(speech.useRendererCapture, false);
    assert.equal(speech.recognitionStartTimer, null);
    assert.equal(streams[0].closed, true);
    assert.equal(stops, 1);
    assert.match(errors[0], /Test/);
  });
}
