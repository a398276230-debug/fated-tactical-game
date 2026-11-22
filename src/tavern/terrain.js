const inBounds = (n, limit = 10) => Number.isInteger(n) && n >= 0 && n < limit;
const height = n => Math.max(-4, Math.min(8, Math.round(Number(n) || 0)));
const list = value => Array.isArray(value) ? value : [];

export function createBattleGrid(battle, seed, units, warnings) {
  const width = battle.width ?? 10, boardHeight = battle.height ?? 10;
  const grid = Array.from({ length: boardHeight }, () => Array.from({ length: width }, () => ({ kind: 'floor', z: 0 })));
  const inGrid = (x, y) => inBounds(x, width) && inBounds(y, boardHeight);
  const anchors = battle.version === 1
    ? [...list(battle.units), ...list(battle.covers), ...list(battle.interactives)].filter(unit => Number.isInteger(unit.z))
    : [];
  if (anchors.some(anchor => anchor.z !== 0)) {
    const reserved = new Set([...(battle.units ?? []), ...list(battle.covers), ...list(battle.interactives)].map(at => `${at.x},${at.y}`));
    const painted = new Set();
    for (const { x, y, z } of anchors) {
      grid[y][x] = { kind:'floor', z };
      if (!z) continue;
      const offsets = [[1,0],[0,1],[-1,0],[0,-1]];
      const start = ((seed + x * 13 + y * 7) >>> 0) % offsets.length;
      for (let i = 0; i < offsets.length; i++) {
        const [dx,dy] = offsets[(start+i)%offsets.length];
        const points = [[x+dx,y+dy,z],[x+2*dx,y+2*dy,Math.abs(z)>1 ? z-Math.sign(z) : 0]];
        if (!points.every(([a,b]) => inGrid(a,b) && !reserved.has(`${a},${b}`) && !painted.has(`${a},${b}`))) continue;
        for (const [a,b,h] of points) {
          grid[b][a] = { kind:h === z ? 'floor' : 'slope', z:h };
          painted.add(`${a},${b}`);
        }
        break;
      }
    }
    // Keep a height transition usable even for the highest explicit starts.
    for (let pass=0; pass<4; pass++) {
      const previous=grid.map(row=>row.map(cell=>cell.z));
      grid.forEach((row,y)=>row.forEach((cell,x)=>{
        if (reserved.has(`${x},${y}`) || painted.has(`${x},${y}`)) return;
        for (const [a,b] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
          const h=previous[b]?.[a];
          if (h !== undefined && Math.abs(h)>Math.abs(cell.z)+2) Object.assign(cell,{kind:'slope',z:h-2*Math.sign(h)});
        }
      }));
    }
    return grid;
  }
  if (battle.terrainMode === 'flat') return grid;
  const legacyTerrain = battle.terrain ?? battle.grid;
  if (battle.terrainMode === 'terrain' || (battle.terrainMode == null && legacyTerrain == null)) {
    // A compact raised platform with ramps, plus two separated walls.
    // Rotate or reflect the layout using the initial seed without consuming combat RNG.
    const layout = seed % 8;
    const transform = (x, y) => [layout & 1 ? width - 1 - x : x, layout & 2 ? boardHeight - 1 - y : y];
    const occupied = new Set([...units,...list(battle.covers),...list(battle.interactives)].map(u => `${u.x},${u.y}`));
    const paint = (x, y, kind, z) => {
      const [a, b] = transform(x, y);
      const [px, py] = layout & 4 ? [b, a] : [a, b];
      if (kind !== 'wall' || !occupied.has(`${px},${py}`)) grid[py][px] = { kind, z };
    };
    const cx = Math.floor(width / 2), cy = Math.floor(boardHeight / 2);
    for (let y = cy - 2; y <= cy; y++) {
      for (let x = cx - 2; x <= cx; x++) paint(x, y, 'floor', 2);
      paint(cx - 3, y, 'slope', 1);
      paint(cx + 1, y, 'slope', 1);
    }
    paint(cx + 2, cy - 3, 'wall', 0);
    paint(cx + 3, cy + 1, 'wall', 0);
    return grid;
  }

  const terrain = legacyTerrain;
  const place = (raw, kind, label) => {
    const [x, y, z] = Array.isArray(raw) ? raw : Array.isArray(raw?.xyz) ? raw.xyz : [raw?.x, raw?.y, raw?.z];
    if (!inGrid(x, y)) { warnings.push(`忽略无效地形坐标：${label}`); return; }
    grid[y][x] = { kind, z: z == null ? grid[y][x].z : height(z) };
  };
  if (Array.isArray(terrain)) {
    if (terrain.length === boardHeight && terrain.every(row => Array.isArray(row) && row.length === width)) {
      terrain.forEach((row, y) => row.forEach((cell, x) => place([x, y, cell?.z], cellKind(cell), 'grid')));
    } else terrain.forEach(cell => place(cell, cellKind(cell), 'terrain'));
  } else {
    for (const region of list(terrain?.elevation)) {
      const { x1, y1, x2, y2, z } = region ?? {};
      if (![x1, x2].every(x => inBounds(x, width)) || ![y1, y2].every(y => inBounds(y, boardHeight)) || x1 > x2 || y1 > y2) {
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
