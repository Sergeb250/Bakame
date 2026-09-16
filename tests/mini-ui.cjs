const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { BrowserWindow, screen } = require('electron');

module.exports = async ({ actualWindowManager: manager, windows, evaluate, waitFor, delay, testDir }) => {
  const main = windows.get('main'), response = windows.get('llmResponse');
  manager.showOnCurrentDesktop(main);
  manager.showOnCurrentDesktop(response);
  await evaluate('llmResponse', `document.getElementById('messageInput').value = 'Keep this unfinished prompt'; document.getElementById('minimizeButton').click()`);
  await waitFor(() => manager.miniOverlay.minimized && windows.get('mini')?.isVisible(), 'minus collapses to dot');
  const dot = windows.get('mini');
  assert.deepEqual(dot.getSize(), [40, 40]);
  assert.equal(dot.isAlwaysOnTop(), true, 'dot starts topmost');
  assert.equal(main.isVisible(), false);
  assert.equal(response.isVisible(), false);
  assert.equal(windows.get('settings').isVisible(), false);
  const duplicate = await Promise.all([manager.miniOverlay.minimize(), manager.miniOverlay.minimize()]);
  assert.ok(duplicate.every(result => result.success));
  assert.equal(windows.size, 4);
  manager.showLLMResponse('A background answer', { messageId: 'mini-answer' });
  await waitFor(() => evaluate('llmResponse', `document.getElementById('chatMessages').textContent.includes('A background answer')`), 'answers continue while collapsed');
  assert.equal(response.isVisible(), false);
  const ignored = [];
  const originalIgnore = dot.setIgnoreMouseEvents;
  dot.setIgnoreMouseEvents = function(ignore, options) { ignored.push(ignore); return originalIgnore.call(this, ignore, options); };
  manager.setInteractive(false);
  assert.equal(ignored.at(-1), false, 'dot stays clickable in click-through mode');
  dot.setIgnoreMouseEvents = originalIgnore;
  assert.equal((await evaluate('main', `window.electronAPI.moveMiniDot('start')`)).success, false, 'only the dot can begin a dot gesture');

  const originalCursor = screen.getCursorScreenPoint;
  let cursor = { x: 200, y: 200 };
  try {
    screen.getCursorScreenPoint = () => cursor;
    manager.miniOverlay.place({ x: 100, y: 100 });
    dot.focus();
    dot.webContents.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
    await waitFor(() => manager.miniOverlay.drag !== null, 'long press arms native movement');
    cursor = { x: 280, y: 250 };
    dot.webContents.sendInputEvent({ type: 'mouseMove', x: 21, y: 21, button: 'left' });
    await waitFor(() => dot.getPosition()[0] === 180 && dot.getPosition()[1] === 150, 'long-press drag moves dot through IPC');
    dot.webContents.sendInputEvent({ type: 'mouseUp', x: 21, y: 21, button: 'left', clickCount: 1 });
    await delay(100);
    assert.equal(manager.miniOverlay.minimized, true, 'drag release does not restore');
    assert.equal(manager.miniOverlay.drag, null);
    dot.webContents.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'left', clickCount: 1 });
    dot.webContents.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'left', clickCount: 1 });
    await waitFor(() => !manager.miniOverlay.minimized, 'short click restores');
    assert.equal(main.isVisible(), true);
    assert.equal(response.isVisible(), true);
    assert.equal(dot.isVisible(), false);
    assert.equal(windows.get('settings').isVisible(), false);
    assert.equal(manager.isInteractive, true);
    assert.deepEqual(main.getPosition(), [180, 150]);
    assert.equal(await evaluate('llmResponse', `document.getElementById('messageInput').value`), 'Keep this unfinished prompt');
  } finally { screen.getCursorScreenPoint = originalCursor; }
  console.log('PASS: collapse, single reusable dot, background answers, draft preservation, long-press movement and click-to-restore');

  await evaluate('main', `document.getElementById('minimizeButton').click()`);
  await waitFor(() => manager.miniOverlay.minimized && dot.isVisible(), 'toolbar minus also collapses');
  assert.equal(windows.get('mini'), dot);
  manager.moveBoundWindows(100000, 100000);
  await delay(150);
  const area = screen.getDisplayMatching(dot.getBounds()).workArea, bounds = dot.getBounds();
  assert.equal(dot.isAlwaysOnTop(), true, 'dot remains topmost after moving across displays');
  assert.ok(bounds.x >= area.x && bounds.x + bounds.width <= area.x + area.width, JSON.stringify({ bounds, area, requested: manager.miniOverlay.position }));
  assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height, JSON.stringify({ bounds, area }));

  // An ordinary fullscreen POS-like window. This does not emulate or modify lockdown policy.
  const otherApp = new BrowserWindow({ x: area.x + 40, y: area.y + 40, width: 800, height: 500, show: false, backgroundColor: '#26384a' });
  try {
    await otherApp.loadURL('data:text/html,<h1>POS fullscreen test</h1>');
    otherApp.setFullScreen(true);
    otherApp.show(); otherApp.focus();
    await waitFor(() => otherApp.isFullScreen(), 'ordinary full-screen window');
    await delay(250);
    assert.equal(dot.isAlwaysOnTop(), true);
    assert.equal(screen.getDisplayMatching(otherApp.getBounds()).id, screen.getDisplayMatching(dot.getBounds()).id, 'full-screen test covers the dot display');
    assert.equal(dot.isVisible(), true, JSON.stringify({ minimized: manager.miniOverlay.minimized, nativeMinimized: dot.isMinimized(), bounds: dot.getBounds(), windows: [...windows].map(([name, win]) => [name, win.isVisible()]) }));
    if (process.platform === 'win32') {
      const handle = dot.getNativeWindowHandle().readBigUInt64LE().toString();
      const probe = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WindowOrderProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  public static bool IsTop(long window) { RECT r; GetWindowRect(new IntPtr(window), out r); POINT p = new POINT {X=(r.Left+r.Right)/2, Y=(r.Top+r.Bottom)/2}; return GetAncestor(WindowFromPoint(p), 2) == new IntPtr(window); }
}
'@
Write-Output ([WindowOrderProbe]::IsTop(${handle}))`;
      const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', probe], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
      assert.equal(result.trim(), 'True', 'Windows hit testing finds the dot above the full-screen window');
    }
    fs.writeFileSync(path.join(testDir, 'mini-dot.png'), (await dot.webContents.capturePage()).toPNG());
  } finally { otherApp.destroy(); }
  await evaluate('mini', `document.getElementById('restoreDot').click()`);
  await waitFor(() => !manager.miniOverlay.minimized, 'keyboard-accessible activation restores');
  response.setSize(420, 380);
  await delay(150);
  assert.equal(await evaluate('llmResponse', `document.getElementById('close-window-btn').getBoundingClientRect().right <= innerWidth`), true, 'all header buttons fit compact width');
  fs.writeFileSync(path.join(testDir, 'mini-restored.png'), (await response.webContents.capturePage()).toPNG());
  console.log('PASS: toolbar control, screen-edge bounds, standard topmost behavior over an ordinary full-screen window, and compact header');
  await manager.miniOverlay.minimize();
  manager.startScreenSharingMode();
  assert.equal(manager.miniOverlay.restore().success, false, 'manual hidden mode prevents dot restore');
  assert.equal(main.isVisible(), false);
  assert.equal(response.isVisible(), false);
  assert.equal(dot.isVisible(), false);
  manager.stopScreenSharingMode();
  assert.equal(manager.miniOverlay.minimized, false);
  assert.equal(main.isVisible(), true);
  assert.equal(response.isVisible(), true);
  console.log('PASS: explicit screen-sharing hide mode remains in effect until disabled');
};
