// 语料加载器：给未来的标准化验收测试用。
// 用法：import { loadCorpus } from './load.mjs';
//      for (const entry of loadCorpus()) { … }   // { file, uid, comment, category, item, effect }
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), 'raw');

/** 展平成「一条效果一行」，便于逐条断言。 */
export function loadCorpus() {
  const rows = [];
  for (const file of readdirSync(RAW).filter(name => name.endsWith('.json')).sort()) {
    const { items } = JSON.parse(readFileSync(join(RAW, file), 'utf8'));
    for (const item of items) {
      for (const [index, effect] of item.effects.entries()) {
        rows.push({
          file, source: item.source, category: item.category, section: item.section ?? null,
          item, effect: { ...effect, index },
        });
      }
    }
  }
  return rows;
}
