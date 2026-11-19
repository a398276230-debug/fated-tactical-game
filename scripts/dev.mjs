import { context } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = resolve(root, 'dist');
const port = Number(process.env.PORT || 8787);

const common = {
  absWorkingDir: root,
  bundle: true,
  target: ['es2022'],
  sourcemap: false,
  legalComments: 'none',
};

const builds = [
  { entryPoints: ['src/index.js'], format: 'esm', outfile: 'dist/index.mjs' },
  { entryPoints: ['src/index.js'], format: 'iife', globalName: 'FatedTactical', outfile: 'dist/index.iife.js' },
  { entryPoints: ['src/tavern/main.js'], format: 'esm', outfile: 'dist/tavern.mjs' },
  { entryPoints: ['src/tavern/main.js'], format: 'iife', globalName: 'FatedTacticalTavern', outfile: 'dist/tavern.iife.js' },
];

const contexts = await Promise.all(builds.map(build => context({ ...common, ...build })));
await Promise.all(contexts.map(build => build.rebuild()));
await Promise.all(contexts.map(build => build.watch()));

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent((request.url || '/').split('?')[0]);
    const relative = requestPath === '/' ? 'tavern.html' : requestPath.replace(/^\/+/, '');
    const file = normalize(resolve(root, relative));
    const rootPrefix = root.endsWith('/') || root.endsWith('\\') ? root : `${root}${process.platform === 'win32' ? '\\' : '/'}`;
    if (file !== root && !file.startsWith(rootPrefix)) {
      response.writeHead(403); response.end('Forbidden'); return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[fated-dev] serving ${root}`);
  console.log(`[fated-dev] Tavern script: http://127.0.0.1:${port}/dist/tavern.iife.js`);
  console.log(`[fated-dev] cache bust: append ?dev=1 (server sends no-store)`);
  console.log('[fated-dev] watching src/ and styles/ for rebuilds');
});

const shutdown = async () => {
  server.close();
  await Promise.all(contexts.map(build => build.dispose()));
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
