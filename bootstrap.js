const { app, BrowserWindow, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');

app.setName('bakame');
if (process.platform === 'win32') app.setAppUserModelId('local.bakame.desktop');
const profile = process.env.BAKAME_TEST_PROFILE && !app.isPackaged
  ? process.env.BAKAME_TEST_PROFILE : path.join(app.getPath('appData'), 'bakame');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const managed = process.argv.find(argument => argument.startsWith('--bakame-service-managed='));
const localHelper = path.join(process.resourcesPath, 'service', 'bakame.Service.exe');
let controlSid = managed?.split('=')[1];

function showFailure(message) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({ width: 480, height: 230, show: false,
      title: 'bakame', webPreferences: { nodeIntegration: false, contextIsolation: true, disableDialogs: true } });
    window.setContentProtection(true);
    window.setMenu(null);
    const escaped = String(message).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
    window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="background:#20232a;color:#eee;font:15px system-ui;padding:24px"><h2>bakame could not start</h2><p>${escaped}</p><p>Close this window and try again.</p></body>`));
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => app.quit());
  });
}

function migrateProfile() {
  const marker = path.join(profile, '.bakame-migrated');
  if (fs.existsSync(marker) || process.env.BAKAME_TEST_PROFILE) return;
  const legacy = path.join(app.getPath('appData'), 'opencluely');
  fs.mkdirSync(profile, { recursive: true });
  // Only migrate a fresh profile. Preserve the legacy copy for rollback.
  if (!fs.existsSync(path.join(profile, '.env')) && !fs.existsSync(path.join(profile, 'Preferences')) && fs.existsSync(legacy)) {
    const excluded = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Crashpad', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK']);
    fs.cpSync(legacy, profile, { recursive: true, force: false, filter: source => !excluded.has(path.basename(source)) });
  }
  fs.writeFileSync(marker, '1.0.1\n');
}

function startDesktop() {
  if (!app.requestSingleInstanceLock()) { app.exit(managed ? 10 : 0); return; }
  try { migrateProfile(); } catch (error) { showFailure(`Settings migration failed: ${error.message}`); return; }
  const { ApplicationController } = require('./main');
  const controller = new ApplicationController();
  app.on('second-instance', () => controller.handleSecondInstance());
  app.whenReady().then(() => Menu.setApplicationMenu(null));
  if (controlSid) {
    const sid = controlSid;
    if (!/^S-1-[\d-]+$/.test(sid)) { app.exit(2); return; }
    // Node's default Windows pipe ACL restricts clients to this user and SYSTEM.
    const server = net.createServer(socket => {
      socket.setEncoding('utf8');
      socket.setTimeout(3000, () => socket.destroy());
      let request = '';
      socket.on('error', () => {});
      socket.on('data', chunk => {
        request += chunk;
        if (request.length > 128) { socket.destroy(); return; }
        if (!request.includes('\n')) return;
        const command = request.trim();
        if (command === 'status') { socket.end(controller.isReady ? 'ready\n' : 'starting\n'); return; }
        socket.end('ok\n');
        if (command === 'activate') {
          const activate = () => {
            if (controller.quitting) return;
            if (controller.isReady) controller.handleSecondInstance();
            else setTimeout(activate, 100);
          };
          activate();
        } else if (command === 'quit') controller.requestQuit();
      });
    });
    server.on('error', error => { console.error('bakame control pipe:', error.message); app.exit(2); });
    server.listen(`\\\\.\\pipe\\bakame-ui-${sid}`);
    app.once('will-quit', () => server.close());
  }
}

if (process.platform === 'win32' && app.isPackaged && !managed && fs.existsSync(localHelper)) {
  const launch = spawnSync(localHelper, ['--auto-launch'], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  if (launch.status === 0) app.exit(0);
  else if (launch.status === 3) {
    const identity = spawnSync(localHelper, ['--user-sid'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (identity.status === 0) controlSid = identity.stdout.trim();
    startDesktop();
  } else showFailure((launch.stderr || launch.error?.message || 'Automatic startup failed. Run the installer to repair Bakame.').trim());
} else startDesktop();
