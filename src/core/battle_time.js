export const timeOfDay = (hour, minute) => {
  const clock = hour * 60 + minute;
  if (clock < 300 || clock >= 1170) return 'night';
  if (clock < 480) return 'dawn';
  return clock < 1020 ? 'day' : 'dusk';
};

export function parseBattleTime(...sources) {
  for (const source of sources) {
    if (typeof source !== 'string') continue;
    const decoded = source.replaceAll('&lt;', '<').replaceAll('&gt;', '>');
    for (const [, block] of [...decoded.matchAll(/<tp>\s*([\s\S]*?)<\/tp>/gi)].reverse()) {
      const raw = block.split('@', 1)[0].trim();
      const match = raw.match(/\b(\d{1,2}):(\d{2})\b/);
      if (!match || raw.length > 500) continue;
      const [, hours, minutes] = match;
      const hour = Number(hours), minute = Number(minutes);
      if (hour > 23 || minute > 59) continue;
      return { raw, hour, minute, timeOfDay: timeOfDay(hour, minute), calendar: raw.slice(0, match.index).replace(/[-\s]+$/, '') };
    }
  }
  return null;
}
