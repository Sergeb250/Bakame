const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createHash } = require('crypto');
const root = path.resolve(__dirname, '..');
const cache = process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache');
const nsisRoot = path.join(cache, 'nsis');
const compiler = fs.readdirSync(nsisRoot).map(name => path.join(nsisRoot, name, 'Bin', 'makensis.exe')).find(file => fs.existsSync(file));
if (!compiler) throw new Error('Build the regular Windows installer first to prepare the NSIS compiler.');
const version = require('../package.json').version;
const result = spawnSync(compiler, [
  '-V2', `-DAPP_DIRECTORY=${path.join(root, 'release', 'win-unpacked')}`,
  `-DOUTPUT_FILE=${path.join(root, 'release', `bakame-Setup-${version}.exe`)}`,
  `-DAPP_VERSION=${version}`, path.join(root, 'windows-service', 'installer.nsi')
], { stdio: 'inherit', windowsHide: true, env: { ...process.env, NSISDIR: path.resolve(path.dirname(compiler), '..') } });
if (result.error) throw result.error;
process.exitCode = result.status || 0;
if (result.status === 0) {
  // Preserve the old download name; both setup files now select their mode automatically.
  fs.copyFileSync(path.join(root, 'release', `bakame-Setup-${version}.exe`),
    path.join(root, 'release', `bakame-Service-Setup-${version}-x64.exe`));
  const setupName = `bakame-Setup-${version}.exe`;
  const setup = fs.readFileSync(path.join(root, 'release', setupName));
  const sha512 = createHash('sha512').update(setup).digest('base64');
  // Electron-builder's metadata describes the intermediate installer. Replace it
  // after producing the adaptive installer, and remove its obsolete block map.
  const blockmap = path.join(root, 'release', setupName + '.blockmap');
  if (fs.existsSync(blockmap)) fs.unlinkSync(blockmap);
  fs.writeFileSync(path.join(root, 'release', 'latest.yml'),
    `version: ${version}\nfiles:\n  - url: ${setupName}\n    sha512: ${sha512}\n    size: ${setup.length}\npath: ${setupName}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
  const names = [setupName, `bakame-Service-Setup-${version}-x64.exe`, `bakame-Portable-${version}-x64.exe`];
  fs.writeFileSync(path.join(root, 'release', 'SHA256SUMS.txt'), names.map(name =>
    `${createHash('sha256').update(fs.readFileSync(path.join(root, 'release', name))).digest('hex')}  ${name}`).join('\n') + '\n');
}
