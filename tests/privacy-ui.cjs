const assert = require('node:assert/strict');
const { desktopCapturer, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = async ({ windows, evaluate, waitFor, delay, testDir, actualWindowManager }) => {
  for (const name of ['main', 'settings', 'llmResponse']) {
    assert.equal(await evaluate(name, `[...document.querySelectorAll('select')].every(s => getComputedStyle(s).display === 'none' && !!document.getElementById(s.id + '-control'))`), true);
    await evaluate(name, `document.getElementById('activeSkill-control').click()`);
    assert.equal(await evaluate(name, `document.querySelectorAll('#activeSkill-options [role=option]').length`), require('../src/core/skills').skills.length);
    await evaluate(name, `document.querySelector('#activeSkill-options').dispatchEvent(new KeyboardEvent('keydown', {key:'End', bubbles:true}))`);
    assert.equal(await evaluate(name, `document.activeElement.dataset.value`), 'dsa');
    await evaluate(name, `document.activeElement.click()`);
    await waitFor(() => evaluate(name, `document.getElementById('activeSkill').value === 'dsa'`), `${name} selects DSA`);
    await evaluate(name, `document.getElementById('activeSkill-control').click(); document.querySelector('#activeSkill-options').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    assert.equal(await evaluate(name, `!!document.querySelector('[role=listbox]')`), false);
    assert.equal(await evaluate(name, `document.activeElement.id`), 'activeSkill-control');
  }
  const before = await evaluate('llmResponse', `localStorage.getItem('opencluely_chat_history_v1')`);
  await evaluate('llmResponse', `document.getElementById('clearHistoryBtn').click()`);
  assert.equal(await evaluate('llmResponse', `!!document.querySelector('[role=alertdialog]')`), true);
  await evaluate('llmResponse', `document.querySelector('.protected-backdrop').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate('llmResponse', `localStorage.getItem('opencluely_chat_history_v1')`), before);
  await evaluate('llmResponse', `document.getElementById('clearHistoryBtn').click(); document.querySelector('.protected-accept').click()`);
  await waitFor(() => evaluate('llmResponse', `localStorage.getItem('opencluely_chat_history_v1') === '[]'`), 'clear confirmed');
  const same = await Promise.all([actualWindowManager.createWindow('settings'), actualWindowManager.createWindow('settings')]);
  assert.equal(same[0], same[1]);
  await delay(300);
  await waitFor(() => evaluate('main', `(() => { const r = document.getElementById('quitButton').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; })()`), 'Quit stays within the toolbar');
  console.log('PASS: protected selectors, keyboard navigation, cancel/clear confirmation, and duplicate-window prevention');
  if (process.platform !== 'win32') return;

  // A solid-color test backdrop lets us verify external capture without saving the user's desktop.
  const display = screen.getPrimaryDisplay();
  const { x, y } = display.workArea;
  actualWindowManager.bindWindows = false;
  // Keep the unprotected backdrop outside the protected application's process.
  const backdrop = spawn(process.execPath, [path.join(__dirname, 'privacy-backdrop.cjs'),
    testDir, String(x + 40), String(y + 70)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Capture backdrop did not start')), 15000);
      backdrop.once('error', reject);
      backdrop.once('exit', code => reject(new Error(`Capture backdrop exited: ${code}`)));
      backdrop.stdout.on('data', chunk => {
        if (chunk.toString().includes('BACKDROP_READY')) { clearTimeout(timer); resolve(); }
      });
    });
    const sample = { x: x + 120, y: y + 120, width: 380, height: 350 };
    const capture = async () => {
      await delay(600);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
        width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor)
      } });
      const source = sources.find(item => item.display_id === String(display.id));
      assert.ok(source, 'primary display captured');
      const size = source.thumbnail.getSize();
      const factor = size.width / display.bounds.width;
      return source.thumbnail.crop({ x: Math.round((sample.x - display.bounds.x) * factor), y: Math.round((sample.y - display.bounds.y) * factor),
        width: Math.round(sample.width * factor), height: Math.round(sample.height * factor) });
    };
    const fractionChanged = (a, b) => {
      const left = a.toBitmap(), right = b.toBitmap();
      let different = 0;
      assert.equal(left.length, right.length);
      for (let i = 0; i < left.length; i += 4) if (Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2]) > 30) different++;
      return different / (left.length / 4);
    };
    const baseline = await capture();
    const pixels = baseline.toBitmap();
    let cyan = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - 195) + Math.abs(pixels[i + 1] - 241) + pixels[i + 2] < 30) cyan++;
    }
    assert.ok(cyan / (pixels.length / 4) > .98, `controlled backdrop covers the capture sample (${cyan / (pixels.length / 4)})`);
    fs.writeFileSync(path.join(testDir, 'lower-backdrop'), '1');
    await waitFor(() => fs.existsSync(path.join(testDir, 'lower-backdrop.done')), 'backdrop lowers');
    const chat = windows.get('llmResponse');
    chat.webContents.send('transcription-llm-response-start', { messageId: 'privacy-question', source: 'voice', prompt: 'Explain a process in simple English.' });
    chat.webContents.send('transcription-llm-response', { messageId: 'privacy-question', response: 'A **process** is a running program. For example, your browser runs as a process.' });
    chat.webContents.send('recording-started', { audioSource: 'both' });
    chat.webContents.send('interim-transcription', { text: 'Give another example...' });
    await waitFor(() => evaluate('llmResponse', `document.querySelector('.prompt-text')?.textContent.includes('Explain a process')`), 'conversation is populated for capture');
    chat.setBounds({ x: sample.x, y: sample.y, width: 500, height: 600 });
    chat.setContentProtection(false);
    chat.show(); chat.hide(); chat.show(); chat.moveTop(); chat.focus();
    const positive = await capture();
    console.log('Capture positive control:', JSON.stringify({bounds: chat.getBounds(), visible: chat.isVisible(), sample, changed: fractionChanged(baseline, positive)}));
    fs.writeFileSync(path.join(testDir, 'positive-control.png'), positive.toPNG());
    assert.ok(fractionChanged(baseline, positive) > .1, 'positive control: unprotected app is captured');
    chat.setContentProtection(true);
    await evaluate('llmResponse', `document.getElementById('clearHistoryBtn').click()`);
    const protectedDialog = await capture();
    fs.writeFileSync(path.join(testDir, 'external-capture-confirmation.png'), protectedDialog.toPNG());
    assert.ok(fractionChanged(baseline, protectedDialog) < .02, 'confirmation is excluded from desktop capture');
    await evaluate('llmResponse', `document.querySelector('.protected-dialog button').click()`);
    chat.webContents.send('recording-stopped');
    chat.hide();
    for (const name of ['main', 'settings', 'llmResponse']) {
      const window = windows.get(name);
      window.setPosition(sample.x, sample.y);
      window.setContentProtection(false);
      window.show(); window.moveTop(); window.focus();
      await evaluate(name, `document.getElementById('${name === 'llmResponse' ? 'audioSource' : 'activeSkill'}-control').click()`);
      const menuPositive = await capture();
      console.log(`${name} capture control:`, JSON.stringify({bounds: window.getBounds(), visible: window.isVisible(), changed: fractionChanged(baseline, menuPositive)}));
      assert.ok(fractionChanged(baseline, menuPositive) > .1, `${name} selector positive control is visible`);
      window.setContentProtection(true);
      const captured = await capture();
      fs.writeFileSync(path.join(testDir, `external-capture-${name}.png`), captured.toPNG());
      assert.ok(fractionChanged(baseline, captured) < .02, `${name} selector excluded from desktop capture`);
      const internal = await window.webContents.capturePage();
      fs.writeFileSync(path.join(testDir, `${name}-dropdown-local.png`), internal.toPNG());
      await evaluate(name, `window.protectedUI.dismiss()`);
      window.hide();
    }
    await actualWindowManager.miniOverlay.minimize();
    const dot = windows.get('mini');
    actualWindowManager.miniOverlay.place({ x: sample.x, y: sample.y });
    Object.assign(sample, { width: 40, height: 40 });
    dot.hide();
    const dotBaseline = await capture();
    dot.showInactive();
    const protectedDot = await capture();
    assert.ok(fractionChanged(dotBaseline, protectedDot) < .02, 'dot is excluded from capture by default');
    dot.setContentProtection(false);
    dot.hide(); dot.showInactive(); dot.moveTop();
    const visibleDot = await capture();
    assert.ok(fractionChanged(dotBaseline, visibleDot) > .05, 'unprotected dot is visible in capture');
    dot.setContentProtection(true);
    fs.writeFileSync(path.join(testDir, 'external-capture-dot.png'), protectedDot.toPNG());
    actualWindowManager.miniOverlay.restore();
    console.log('PASS: real Windows desktop capture excludes the dot, skill menus and clear-history dialog; unprotected positive controls remain visible');
  } finally { backdrop.kill(); }
};
