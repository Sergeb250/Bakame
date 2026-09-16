const assert = require('node:assert/strict');
const { screen, globalShortcut } = require('electron');

module.exports = async ({ windows, evaluate, waitFor, delay, actualWindowManager, controller }) => {
  const main = windows.get('main');
  const response = windows.get('llmResponse');
  const area = screen.getDisplayMatching(main.getBounds()).workArea;
  assert.equal(await evaluate('main', "getComputedStyle(document.getElementById('moveHandle')).getPropertyValue('-webkit-app-region')"), 'drag');
  assert.equal(await evaluate('main', "getComputedStyle(document.getElementById('micButton')).getPropertyValue('-webkit-app-region')"), 'no-drag');
  const anchor = { x: area.x + 80, y: area.y + 110 };
  main.setPosition(anchor.x, anchor.y); // Native window move, as emitted by dragging.
  await waitFor(() => actualWindowManager.boundWindowsPosition?.x === anchor.x && actualWindowManager.boundWindowsPosition?.y === anchor.y, 'native drag position recorded');
  actualWindowManager.positionBoundWindows();
  assert.deepEqual(main.getPosition(), [anchor.x, anchor.y]);
  assert.equal(response.getPosition()[0], anchor.x);
  const height = response.getSize()[1];
  response.setSize(response.getSize()[0], height - 30);
  actualWindowManager.positionBoundWindows();
  assert.deepEqual(main.getPosition(), [anchor.x, anchor.y], 'answer resize preserves toolbar position');
  await evaluate('main', "document.getElementById('moveHandle').focus(); document.getElementById('moveHandle').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}))");
  await waitFor(() => main.getPosition()[0] === anchor.x + 20, 'focused Move handle arrow key through IPC');
  assert.equal(response.getPosition()[0], anchor.x + 20);
  const registered = new Map();
  const originalRegister = globalShortcut.register;
  try {
    globalShortcut.register = (key, handler) => { registered.set(key, handler); return true; };
    controller.setupGlobalShortcuts();
  } finally { globalShortcut.register = originalRegister; }
  for (const direction of ['Up', 'Down', 'Left', 'Right']) {
    assert.equal(typeof registered.get(`CommandOrControl+Shift+${direction}`), 'function');
  }
  registered.get('CommandOrControl+Shift+Down')();
  assert.equal(main.getPosition()[1], anchor.y + 20, 'global shortcut moves while interaction is enabled');
  assert.equal((await evaluate('main', 'window.electronAPI.moveWindow(NaN, 0)')).success, false);
  const moved = main.getPosition();
  actualWindowManager.trackActiveScreen();
  assert.deepEqual(main.getPosition(), moved, 'cursor tracking preserves explicit placement');
  await evaluate('main', "window.electronAPI.moveWindow(100000, 100000)");
  await waitFor(() => {
    const bounds = main.getBounds();
    return bounds.x + bounds.width === area.x + area.width && bounds.y + bounds.height === area.y + area.height;
  }, 'toolbar settles at the screen edge after pending content resizes');
  const bounds = main.getBounds(), answer = response.getBounds();
  assert.equal(bounds.x + bounds.width, area.x + area.width);
  assert.equal(bounds.y + bounds.height, area.y + area.height, JSON.stringify({ bounds, area, display: actualWindowManager.currentDisplay, anchor: actualWindowManager.boundWindowsPosition, applied: actualWindowManager.appliedMainPosition }));
  assert.ok(answer.y >= area.y && answer.y + answer.height <= area.y + area.height);
  assert.ok(answer.x >= area.x && answer.x + answer.width <= area.x + area.width);
  await evaluate('main', "window.electronAPI.moveWindow(-100000, -100000)");
  assert.deepEqual(main.getPosition(), [area.x, area.y]);
  main.setPosition(anchor.x, anchor.y);
  await delay(100);
  console.log('PASS: native movement, keyboard movement via IPC, answer following, resize retention, and screen-edge bounds');
};
