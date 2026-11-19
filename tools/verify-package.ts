import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, readAppTree } from '../vendor/makefun-app.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const first = resolve(root, process.argv[2] || '.verification/output-a');
const second = resolve(root, process.argv[3] || '.verification/output-b');
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

function tree(directory) {
  const items = [];
  function walk(path) {
    for (const name of readdirSync(join(directory, path)).sort()) {
      const relative = path ? `${path}/${name}` : name;
      const info = lstatSync(join(directory, relative));
      if (info.isDirectory()) { items.push({ path: relative, type: 'directory' }); walk(relative); }
      else if (info.isFile()) items.push({ path: relative, type: 'file' });
      else throw new Error(`Unexpected special file: ${relative}`);
    }
  }
  walk('');
  return items;
}

const a = tree(first);
const b = tree(second);
if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Output trees differ.');
let bytes = 0;
for (const item of a.filter(item => item.type === 'file')) {
  const left = readFileSync(join(first, item.path));
  const right = readFileSync(join(second, item.path));
  if (!left.equals(right)) throw new Error(`Output bytes differ: ${item.path}`);
  bytes += left.length;
}
for (const output of [first, second]) {
  const dossier = readFileSync(join(output, 'dossier.json'));
  if (!dossier.equals(Buffer.from(buildDossier(output, caps)))) throw new Error('Dossier does not match the official API.');
  const document = JSON.parse(dossier.toString('utf8'));
  if (document.images.length !== 4 || document.images[0].name !== '1-cover.jpg') throw new Error('Wrong dossier screenshots.');
  if (Buffer.byteLength(document.text) > caps.text_max_bytes) throw new Error('Dossier text cap exceeded.');
  if (document.text.includes('[Cut at')) throw new Error('Original application source was cut out of the dossier.');
  if (readFileSync(join(output, 'app/index.html')).length > 1048576) throw new Error('index.html is too large.');
}

const kit = '/home/hatch/workspace/makefun/gta6-cover-art-01-kit/gta6-cover-art-01-kit/starter';
for (const name of ['vendor/makefun-app.ts', 'app/samples/boulevard.jpg', 'app/samples/pier.jpg']) {
  if (!readFileSync(join(root, name)).equals(readFileSync(join(kit, name)))) throw new Error(`Required verbatim copy changed: ${name}`);
}
if (!readFileSync(join(root, 'LICENSE'), 'utf8').startsWith('SPDX-License-Identifier: MIT\n')) throw new Error('Wrong license first line.');

const app = readAppTree(join(first, 'app'), caps);
const dossier = readFileSync(join(first, 'dossier.json'));
console.log(JSON.stringify({
  byteIdentical: true,
  filesCompared: a.filter(item => item.type === 'file').length,
  directoriesCompared: a.filter(item => item.type === 'directory').length,
  totalOutputBytes: bytes,
  dossierBytes: dossier.length,
  dossierSHA256: createHash('sha256').update(dossier).digest('hex'),
  allApplicationSourceIncluded: true,
  verbatimKitCopies: 3,
  appEntries: app.count,
  appBytes: app.totalBytes,
}, null, 2));
