const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakame-privacy-'));
fs.writeFileSync(path.join(testDir, '.env'), 'GEMINI_API_KEY=test-key\nSPEECH_PROVIDER=whisper\n');
const env = { ...process.env, OPENCLUELY_TEST_DIR: testDir, OPENCLUELY_TEST_PHASE: 'privacy' };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(require('electron'), [path.join(__dirname, '../tests/skills-ui.cjs')], {
  env, stdio: 'inherit', windowsHide: true, timeout: 120000
});
if (result.error) console.error(result.error.message);
console.log(`Privacy artifacts: ${testDir}`);
process.exitCode = result.status || (result.error ? 1 : 0);
