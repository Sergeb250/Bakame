const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const parent = process.ppid;
setInterval(() => { try { process.kill(parent, 0); } catch { app.exit(0); } }, 1000).unref();
app.setPath('userData', path.join(process.argv[2], 'backdrop'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const backdrop = new BrowserWindow({
    x: Number(process.argv[3]), y: Number(process.argv[4]), width: 920, height: 710,
    frame: false, show: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00f1c3'
  });
  backdrop.setContentProtection(false);
  await backdrop.loadURL('data:text/html,<body style="margin:0;background:%2300f1c3"></body>');
  backdrop.show();
  // Windows can apply the launcher's hidden startup flag to the first ShowWindow.
  backdrop.hide();
  backdrop.show();
  backdrop.moveTop();
  backdrop.focus();
  const stage = path.join(process.argv[2], 'lower-backdrop');
  const timer = setInterval(() => {
    if (!fs.existsSync(stage)) return;
    clearInterval(timer);
    backdrop.setAlwaysOnTop(false);
    fs.writeFileSync(stage + '.done', '1');
  }, 100);
  console.log('BACKDROP_READY');
});
