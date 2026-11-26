import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const styles = await Promise.all([
  ['battleTheme', 'battle-theme.css'], ['tacticalUI', 'tactical-ui.css'],
].map(async ([name, file]) => {
  const css = (await readFile(resolve(root, 'styles', file), 'utf8')).replaceAll('\r\n', '\n');
  return `export const ${name} = ${JSON.stringify(css)};`;
}));
const stylesModule = resolve(root, 'src/ui/styles.js');
const generatedStyles = `${styles.join('\n')}\n`;
const existingStyles = await readFile(stylesModule, 'utf8').catch(error => {
  if (error.code !== 'ENOENT') throw error;
  return '';
});
if (existingStyles.replaceAll('\r\n', '\n') !== generatedStyles) {
  await writeFile(stylesModule, generatedStyles);
}

const outdir = resolve(root, 'dist');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  absWorkingDir: root,
  bundle: true,
  target: ['es2022'],
  sourcemap: false,
  legalComments: 'none',
};
await build({ ...common, entryPoints: ['src/index.js'], format: 'esm', outfile: 'dist/index.mjs' });
await build({ ...common, entryPoints: ['src/index.js'], format: 'iife', globalName: 'FatedTactical', outfile: 'dist/index.iife.js' });
await build({ ...common, entryPoints: ['src/tavern/main.js'], format: 'esm', outfile: 'dist/tavern.mjs' });
await build({ ...common, entryPoints: ['src/tavern/main.js'], format: 'iife', globalName: 'FatedTacticalTavern', outfile: 'dist/tavern.iife.js' });
console.log('Built dist/index.mjs, dist/index.iife.js, dist/tavern.mjs, dist/tavern.iife.js');
