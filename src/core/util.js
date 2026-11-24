export const own = (record, key) => record != null && Object.hasOwn(record, key) ? record[key] : undefined;
export const hasOwn = (record, key) => record != null && Object.hasOwn(record, key);
export const ownDataValue = (record, key) => record == null ? undefined : Object.getOwnPropertyDescriptor(record, key)?.value;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const samePoint = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);
export const cellKey = point => `${point.x},${point.y}`;
