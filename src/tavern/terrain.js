const inBounds = n => Number.isInteger(n) && n >= 0 && n <= 9;
const height = n => Math.max(-4, Math.min(8, Math.round(Number(n) || 0)));
const list = value => Array.isArray(value) ? value : [];

export function createBattleGrid(battle, seed, units, warnings) {
  const grid = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ kind: 'floor', z: 0 })));
  if (battle.terrainMode === 'flat') return grid;
  const legacyTerrain = battle.terrain ?? battle.grid;
  if (battle.terrainMode === 'terrain' || (battle.terrainMode == null && legacyTerrain == null)) {
    // A compact raised platform with ramps, plus two separated walls.
    // Rotate or reflect the layout using the initial seed without consuming combat RNG.
    const layout = seed % 8;
    const transform = (x, y) => [layout & 1 ? 9 - x : x, layout & 2 ? 9 - y : y];
    const occupied = new Set(units.map(u => `${u.x},${u.y}`));
    const paint = (x, y, kind, z) => {
      const [a, b] = transform(x, y);
      const [px, py] = layout & 4 ? [b, a] : [a, b];
      if (kind !== 'wall' || !occupied.has(`${px},${py}`)) grid[py][px] = { kind, z };
    };
    for (let y = 3; y <= 5; y++) {
      for (let x = 2; x <= 4; x++) paint(x, y, 'floor', 2);
      paint(1, y, 'slope', 1);
      paint(5, y, 'slope', 1);
    }
    paint(6, 2, 'wall', 0);
    paint(7, 6, 'wall', 0);
    return grid;
  }

  const terrain = legacyTerrain;
  const place = (raw, kind, label) => {
    const [x, y, z] = Array.isArray(raw) ? raw : Array.isArray(raw?.xyz) ? raw.xyz : [raw?.x, raw?.y, raw?.z];
    if (!inBounds(x) || !inBounds(y)) { warnings.push(`忽略无效地形坐标：${label}`); return; }
    grid[y][x] = { kind, z: z == null ? grid[y][x].z : height(z) };
  };
  if (Array.isArray(terrain)) {
    if (terrain.length === 10 && terrain.every(row => Array.isArray(row) && row.length === 10)) {
      terrain.forEach((row, y) => row.forEach((cell, x) => place([x, y, cell?.z], cellKind(cell), 'grid')));
    } else terrain.forEach(cell => place(cell, cellKind(cell), 'terrain'));
  } else {
    for (const region of list(terrain?.elevation)) {
      const { x1, y1, x2, y2, z } = region ?? {};
      if (![x1, y1, x2, y2].every(inBounds) || x1 > x2 || y1 > y2) {
        warnings.push('忽略无效地形坐标：grid.elevation');
        continue;
      }
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) grid[y][x].z = height(z);
    }
    for (const slope of list(terrain?.slopes)) place(slope, 'slope', 'grid.slopes');
    for (const wall of list(terrain?.walls)) place(wall, 'wall', 'grid.walls');
  }
  return grid;
}

function cellKind(cell) {
  const kind = String(cell?.kind ?? cell?.type ?? '').toLowerCase();
  return ['wall', 'slope'].includes(kind) ? kind : kind === 'highground' ? 'slope' : 'floor';
}
