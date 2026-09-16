// Opt-in integration check: a real local model transcribes generated speech.
// No microphone, speaker output, or AI-provider requests are used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const WhisperWorker = require('../src/services/whisper-worker.service');
const root = path.resolve(__dirname, '..');
const pythonPath = process.argv[2] || path.join(root, '.venv-whisper', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const model = process.argv[3] || 'base';
const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-whisper-check-'));
const audioPath = path.join(sampleDir, 'question.wav');
const fixture = process.argv[4];
if (fixture) fs.copyFileSync(path.resolve(fixture), audioPath);
else if (process.platform === 'win32') {
  const generated = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -AssemblyName System.Speech; $voiceCheck = New-Object System.Speech.Synthesis.SpeechSynthesizer; $voiceCheck.SetOutputToWaveFile($env:OPENCLUELY_SAMPLE_PATH); $voiceCheck.Speak("What is the difference between a process and a thread?"); $voiceCheck.Dispose()'],
  { env: { ...process.env, OPENCLUELY_SAMPLE_PATH: audioPath }, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  if (generated.error || generated.status !== 0) throw Error(generated.error?.message || generated.stderr);
} else throw Error('Pass a WAV fixture as the fourth argument on this platform.');

const worker = new WhisperWorker();
worker.configure({ pythonPath, scriptPath: path.join(root, 'scripts/whisper_worker.py') });
worker.setKeepWarm(true);
async function main() {
  const options = { model, modelDir: path.join(root, '.whisper-models'), device: 'cpu', language: 'en' };
  console.log(`Loading ${model} with the persistent Python worker...`);
  const warmupAt = Date.now();
  await worker.warmup(options);
  console.log(`Model ready in ${Date.now() - warmupAt} ms`);
  const pid = worker.process.pid;
  for (let run = 1; run <= 3; run++) {
    const start = Date.now();
    const result = await worker.transcribe(audioPath, { ...options, language: run === 3 ? 'auto' : 'en' });
    if (!fixture) {
      assert.match(result.text.toLowerCase(), /difference.*process.*thread/);
    } else assert.ok(result.text.trim());
    assert.equal(worker.process.pid, pid, 'same worker is reused');
    console.log(JSON.stringify({ run, elapsedMs: Date.now() - start, text: result.text, model: result.model, device: result.device, engine: result.engine, language: result.language }));
  }
  console.log(`PASS: real Whisper inference and persistent model reuse. Sample: ${audioPath}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => worker.close());
