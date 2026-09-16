const { spawn } = require('child_process');
const path = require('path');

// Works in PowerShell, cmd, and POSIX shells, including from a Node-hosted IDE.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit', windowsHide: true
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
