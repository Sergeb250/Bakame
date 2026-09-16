const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getOverlayLayout } = require('../src/core/overlay-position');
const defaults = { mainSize: [400, 30], responseSize: [840, 480], workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

test('answers follow a chosen position through repeated layout and size changes', () => {
  const anchor = { x: 240, y: 250 };
  const layout = getOverlayLayout({ ...defaults, anchor });
  assert.deepEqual(layout, { main: anchor, response: { x: 240, y: 290 } });
  const resized = getOverlayLayout({ ...defaults, anchor, mainSize: [470, 30], responseSize: [700, 550] });
  assert.deepEqual(resized.main, anchor);
  assert.deepEqual(resized.response, { x: 240, y: 290 });
});

test('the toolbar can reach the bottom-right; the answer fits above without moving it', () => {
  const result = getOverlayLayout({ ...defaults, anchor: { x: 1520, y: 1010 } });
  assert.deepEqual(result.main, { x: 1520, y: 1010 });
  assert.deepEqual(result.response, { x: 1080, y: 520 });
});

test('negative monitor coordinates, missing response windows, and off-screen anchors are supported', () => {
  const workArea = { x: -1280, y: -100, width: 1280, height: 720 };
  const result = getOverlayLayout({ ...defaults, workArea, anchor: { x: -1100, y: 100 } });
  assert.deepEqual(result.main, { x: -1100, y: 100 });
  assert.deepEqual(result.response, { x: -1100, y: 140 });
  const removedMonitor = getOverlayLayout({ ...defaults, responseSize: null, anchor: { x: -1100, y: -100 } });
  assert.deepEqual(removedMonitor, { main: { x: 0, y: 0 } });
});

test('oversized windows remain reachable and initial placement has integer coordinates', () => {
  const result = getOverlayLayout({ ...defaults, workArea: { x: 0, y: 0, width: 600, height: 400 }, anchor: { x: 300, y: 360 } });
  assert.deepEqual(result.main, { x: 200, y: 360 });
  assert.deepEqual(result.response, { x: 0, y: 0 });
  const initial = getOverlayLayout({ ...defaults, workArea: { x: 0, y: 0, width: 1919, height: 1040 } });
  assert.equal(Number.isInteger(initial.main.x), true);
  assert.equal(initial.main.y, 20);
});
