import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

// Packaging uses only checked-in static bytes. No clock, randomness, or machine paths
// enter the dossier, and an earlier build cannot leave extra files in either tree.
const source = fileURLToPath(new URL('.', import.meta.url));
const destination = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

function contains(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function copyStaticTree(from, to) {
  if (!lstatSync(from).isDirectory()) throw new Error(`Expected a directory: ${from}`);
  mkdirSync(to, { recursive: true });
  const entries = readdirSync(from).sort();
  for (const name of entries) {
    const input = join(from, name);
    const output = join(to, name);
    const info = lstatSync(input);
    if (info.isDirectory()) copyStaticTree(input, output);
    else if (info.isFile()) copyFileSync(input, output);
    else throw new Error(`Static entries must be plain files or directories: ${input}`);
  }
}

for (const name of ['app', 'screenshots']) {
  const input = join(source, name);
  const output = join(destination, name);
  if (contains(output, input) || contains(input, output)) {
    throw new Error('The output directory must not overlap a source asset tree.');
  }
}
mkdirSync(destination, { recursive: true });
for (const name of ['app', 'screenshots']) {
  const output = join(destination, name);
  rmSync(output, { recursive: true, force: true });
  copyStaticTree(join(source, name), output);
}
writeFileSync(join(destination, 'dossier.json'), buildDossier(destination, caps));
