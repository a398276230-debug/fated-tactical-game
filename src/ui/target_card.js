// Fixed overlay next to a cell. Never change grid dimensions or scroll the page.
export function placeTargetCard(card, anchor, viewport = window.visualViewport) {
  const gutter = 8, gap = 6;
  const left = (viewport?.offsetLeft ?? 0) + gutter;
  const top = (viewport?.offsetTop ?? 0) + gutter;
  const right = left + (viewport?.width ?? document.documentElement.clientWidth) - 2 * gutter;
  const bottom = top + (viewport?.height ?? window.innerHeight) - 2 * gutter;
  card.style.maxWidth = `${Math.max(0, right - left)}px`;
  const viewportHeight = Math.max(0, bottom - top);
  const a = anchor.getBoundingClientRect();
  const { width, height: renderedHeight } = card.getBoundingClientRect();
  // Measure the content without temporarily expanding the scroll container:
  // expanding then shrinking clamps scrollTop on every captured scroll event.
  const list = card.dataset.submenu ? card.querySelector('#action-toolbar') : null;
  const listOverflow = list ? Math.max(0, list.scrollHeight - list.clientHeight) : 0;
  const height = Math.min(viewportHeight, card.scrollHeight + renderedHeight - card.clientHeight + listOverflow);
  let maxHeight = viewportHeight;
  const room = { right: right - a.right - gap, left: a.left - left - gap,
    below: bottom - a.bottom - gap, above: a.top - top - gap };
  const clamp = (v, min, max) => Math.max(min, Math.min(v, max));
  let x, y;
  if (room.right >= width || room.left >= width) {
    x = room.right >= width ? a.right + gap : a.left - gap - width;
    y = a.top + (a.height - height) / 2;
  } else {
    const below = room.below >= height || (room.above < height && room.below >= room.above);
    x = a.left + (a.width - width) / 2;
    y = below ? a.bottom + gap : a.top - gap - height;
    const available = below ? room.below : room.above;
    if (available < height && available >= 80) {
      maxHeight = available;
      if (!below) y = a.top - gap - available;
    }
  }
  card.style.maxHeight = `${maxHeight}px`;
  card.style.left = `${clamp(x, left, right - width)}px`;
  card.style.top = `${clamp(y, top, bottom - card.getBoundingClientRect().height)}px`;
}
