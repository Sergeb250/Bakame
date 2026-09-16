const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
if (process.platform !== 'win32') throw new Error('Build the Windows service on Windows.');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'build', 'windows-service');
fs.mkdirSync(output, { recursive: true });
const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const result = spawnSync(compiler, [
  '/nologo', '/target:exe', '/platform:x64', '/optimize+',
  '/reference:System.ServiceProcess.dll', '/reference:System.Core.dll',
  `/out:${path.join(output, 'bakame.Service.exe')}`,
  path.join(root, 'windows-service', 'OpenCluelyService.cs')
], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const checked = spawnSync(path.join(output, 'bakame.Service.exe'), ['--self-test'], {
  stdio: 'inherit', windowsHide: true, timeout: 30000
});
if (checked.error) throw checked.error;
process.exitCode = checked.status || 0;
