const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bakame-lifecycle-'));
fs.writeFileSync(path.join(profile, '.env'), 'SPEECH_PROVIDER=azure\nACTIVE_SKILL=writing\n');
const sid = `S-1-5-21-${process.pid}`;
const pipe = `\\\\.\\pipe\\bakame-ui-${sid}`;
const env = { ...process.env, BAKAME_TEST_PROFILE: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.GEMINI_API_KEY;
delete env.AZURE_SPEECH_KEY;
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch() {
  const child = spawn(require('electron'), [path.join(process.env.OPENCLUELY_APP_ROOT || root, 'bootstrap.js'), `--bakame-service-managed=${sid}`], {
    env, windowsHide: true, stdio: 'ignore'
  });
  children.push(child);
  return child;
}
function command(message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe, () => socket.write(message + '\n'));
    socket.setTimeout(1000, () => socket.destroy(new Error('control timeout')));
    socket.once('data', data => { socket.destroy(); resolve(data.toString().trim()); });
    socket.once('error', reject);
  });
}
async function ready(child, waitForDesktop = true) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, 'primary still running');
    try {
      const status = await command('status');
      if (!waitForDesktop || status === 'ready') return;
    } catch { }
    await delay(100);
  }
  throw new Error('Desktop did not become ready');
}
async function exited(child, expected) {
  const deadline = Date.now() + 12000;
  while (child.exitCode === null && Date.now() < deadline) await delay(100);
  assert.equal(child.exitCode, expected, 'expected process exit');
}
(async () => {
  try {
    const first = launch();
    await ready(first);
    const duplicates = [launch(), launch(), launch()];
    await Promise.all(duplicates.map(child => exited(child, 10)));
    await delay(2000);
    assert.equal(first.exitCode, null);
    await command('quit');
    await exited(first, 0);
    const reopened = launch();
    await ready(reopened, false);
    await command('quit');
    await exited(reopened, 0);
    console.log('PASS: real desktop bootstrap, concurrent duplicate launches, clean Quit, and reopening with isolated persisted settings');
  } finally {
    for (const child of children) if (child.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
