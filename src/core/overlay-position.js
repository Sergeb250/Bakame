// Keep the toolbar where the user placed it; fit the answer around that anchor.
function getOverlayLayout({ anchor, mainSize, responseSize, workArea, gap = 10 }) {
  const clamp = (value, start, available, size) =>
    Math.round(Math.max(start, Math.min(value, start + Math.max(0, available - size))));
  const [width, height] = mainSize;
  const area = workArea;
  const initialWidth = Math.max(width, responseSize?.[0] || 0);
  const requested = anchor || { x: area.x + (area.width - initialWidth) / 2, y: area.y + 20 };
  const main = {
    x: clamp(requested.x, area.x, area.width, width),
    y: clamp(requested.y, area.y, area.height, height)
  };
  if (!responseSize) return { main };
  const [responseWidth, responseHeight] = responseSize;
  const below = main.y + height + gap;
  const above = main.y - responseHeight - gap;
  const preferredY = below + responseHeight <= area.y + area.height ? below
    : above >= area.y ? above : below;
  return { main, response: {
    x: clamp(main.x, area.x, area.width, responseWidth),
    y: clamp(preferredY, area.y, area.height, responseHeight)
  } };
}

module.exports = { getOverlayLayout };
