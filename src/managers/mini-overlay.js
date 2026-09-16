const { screen } = require('electron');
const { getOverlayLayout } = require('../core/overlay-position');

class MiniOverlay {
  constructor(manager) {
    this.manager = manager;
    this.minimized = false;
    this.visibleWindows = new Set();
    this.position = null;
    this.pending = null;
    this.drag = null;
    this.moved = false;
  }

  minimize() {
    if (this.pending) return this.pending;
    if (this.minimized) return Promise.resolve({ success: true });
    this.pending = this.collapse().finally(() => { this.pending = null; });
    return this.pending;
  }

  async collapse() {
    const manager = this.manager;
    if (manager.isScreenBeingShared) return { success: false, error: 'Windows are hidden in screen sharing mode.' };
    const dot = await manager.createWindow('mini');
    if (manager.isScreenBeingShared) return { success: false, error: 'Windows are hidden in screen sharing mode.' };
    this.visibleWindows = new Set([...manager.windows].filter(([type, window]) =>
      type !== 'mini' && !window.isDestroyed() && window.isVisible()).map(([type]) => type));
    if (!this.visibleWindows.size) this.visibleWindows.add('main');
    this.previousActiveWindow = manager.activeWindow;
    const main = manager.windows.get('main');
    this.position ||= main ? { x: main.getBounds().x, y: main.getBounds().y } : screen.getCursorScreenPoint();
    this.minimized = true;
    this.moved = false;
    this.place(this.position);
    for (const [type, window] of manager.windows) if (type !== 'mini' && !window.isDestroyed()) window.hide();
    dot.setIgnoreMouseEvents(false);
    dot.setAlwaysOnTop(true);
    dot.showInactive();
    manager.isVisible = true;
    return { success: true };
  }

  // Automatic answers update the hidden renderer without opening the panels.
  keepHidden(window) {
    if (!this.minimized || window === this.manager.windows.get('mini')) return false;
    for (const [type, candidate] of this.manager.windows) if (candidate === window) this.visibleWindows.add(type);
    return true;
  }

  restore() {
    if (!this.minimized) return { success: true };
    if (this.manager.isScreenBeingShared) return { success: false, error: 'Windows are hidden in screen sharing mode.' };
    this.minimized = false;
    this.drag = null;
    const manager = this.manager;
    const dot = manager.windows.get('mini');
    dot?.hide();
    if (this.moved && this.position) {
      manager.boundWindowsPosition = { ...this.position };
      manager.hasUserPosition = true;
      manager.currentDisplay = screen.getDisplayNearestPoint(this.position);
      manager.positionBoundWindows();
    }
    manager.setInteractive(true);
    for (const type of this.visibleWindows) manager.showOnCurrentDesktop(manager.windows.get(type));
    manager.activeWindow = this.previousActiveWindow || 'main';
    manager.isVisible = true;
    return { success: true };
  }

  place(position) {
    const dot = this.manager.windows.get('mini');
    if (!dot || dot.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(position);
    this.position = getOverlayLayout({ anchor: position, mainSize: dot.getSize(), workArea: display.workArea }).main;
    const [x, y] = dot.getPosition();
    if (x !== this.position.x || y !== this.position.y) dot.setPosition(this.position.x, this.position.y);
  }

  move(phase) {
    if (!this.minimized) return { success: false };
    const dot = this.manager.windows.get('mini');
    if (!dot || dot.isDestroyed()) return { success: false };
    if (phase === 'start') {
      const [x, y] = dot.getPosition();
      this.drag = { cursor: screen.getCursorScreenPoint(), x, y };
    } else if (phase === 'move' && this.drag) {
      // Electron's cursor position is in DIP, including mixed-DPI monitors.
      const cursor = screen.getCursorScreenPoint();
      const x = this.drag.x + cursor.x - this.drag.cursor.x;
      const y = this.drag.y + cursor.y - this.drag.cursor.y;
      this.moved ||= x !== this.drag.x || y !== this.drag.y;
      this.place({ x, y });
    } else if (phase === 'end') this.drag = null;
    else return { success: false };
    return { success: true };
  }
}

module.exports = MiniOverlay;
