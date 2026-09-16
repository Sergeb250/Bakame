// Launch Electron checks with isolated settings and no live provider requests.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencluely-skills-'));
fs.writeFileSync(path.join(testDir, '.env'), 'GEMINI_API_KEY=test-key\nSPEECH_PROVIDER=whisper\n');
const env = { ...process.env, OPENCLUELY_TEST_DIR: testDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ACTIVE_SKILL;
delete env.CODING_LANGUAGE;
for (const phase of ['interaction', 'restart']) {
  const result = spawnSync(require('electron'), [path.join(__dirname, '../tests/skills-ui.cjs')], {
    env: { ...env, OPENCLUELY_TEST_PHASE: phase },
    stdio: 'inherit',
    windowsHide: true,
    timeout: 120000
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Electron checks passed. Screenshots: ${testDir}`);
