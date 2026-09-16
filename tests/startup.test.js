const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../bootstrap.js'), 'utf8');

async function boot({ result = 3, managed = false, duplicate = false } = {}) {
  const calls = [], exits = [], pipes = [], failures = [];
  let desktop = 0;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, setName() {}, setAppUserModelId() {}, setPath() {},
    getPath: () => 'C:/profile', whenReady: () => Promise.resolve(),
    requestSingleInstanceLock: () => !duplicate, exit: code => exits.push(code)
  });
  class Window { setContentProtection() {} setMenu() {} loadURL(url) { failures.push(url); } once() {} on() {} }
  const modules = {
    electron: { app, BrowserWindow: Window, Menu: { setApplicationMenu() {} } },
    'node:path': path,
    'node:fs': { mkdirSync() {}, existsSync: () => true },
    'node:net': { createServer: () => ({ on() {}, listen: pipe => pipes.push(pipe), close() {} }) },
    'node:child_process': { spawnSync: (_file, args) => {
      calls.push(args[0]);
      return args[0] === '--user-sid' ? { status: 0, stdout: 'S-1-5-21-123\n' }
        : { status: result, stderr: result === 1 ? 'Service setup failed' : '' };
    } },
    './main': { ApplicationController: class { constructor() { desktop++; } } }
  };
  vm.runInNewContext(source, {
    require: name => { assert.ok(modules[name], name); return modules[name]; },
    process: { platform: 'win32', env: {}, resourcesPath: 'C:/app/resources',
      argv: managed ? ['--bakame-service-managed=S-1-5-21-123'] : [] },
    console, setTimeout
  });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, exits, pipes, desktop, failures };
}

test('normal startup opens one background desktop with a handoff pipe', async () => {
  const state = await boot();
  assert.deepEqual(state.calls, ['--auto-launch', '--user-sid']);
  assert.equal(state.desktop, 1);
  assert.equal(state.pipes.length, 1);
  assert.match(state.pipes[0], /bakame-ui-S-1-5-21-123$/);
  assert.deepEqual(state.exits, []);
});
test('administrator startup exits its launcher after the service takes ownership', async () => {
  const state = await boot({ result: 0 });
  assert.deepEqual(state.calls, ['--auto-launch']);
  assert.equal(state.desktop, 0);
  assert.deepEqual(state.exits, [0]);
});
test('a service-managed desktop never recursively registers or launches a service', async () => {
  const state = await boot({ managed: true });
  assert.deepEqual(state.calls, []);
  assert.equal(state.desktop, 1);
  assert.equal(state.pipes.length, 1);
});
test('repeated normal launches reuse the desktop and do not create another control pipe', async () => {
  const state = await boot({ duplicate: true });
  assert.equal(state.desktop, 0);
  assert.deepEqual(state.exits, [0]);
  assert.equal(state.pipes.length, 0);
});
test('service setup failure is visible and cannot silently report a background launch as service mode', async () => {
  const state = await boot({ result: 1 });
  assert.equal(state.desktop, 0);
  assert.equal(state.failures.length, 1);
  assert.match(decodeURIComponent(state.failures[0]), /Service setup failed/);
});
