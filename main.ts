import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';
import { CAPS, DOSSIER_BUDGET, offlineFacts, screenshotFacts, studioFacts, sha256 } from './tools/artifact-facts.ts';
import { verifyBundle } from './tools/bundle.ts';

// Packaging uses only checked-in static bytes. No clock, randomness, or machine paths
// enter the dossier, and an earlier build cannot leave extra files in either tree.
const source = fileURLToPath(new URL('.', import.meta.url));
const destination = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

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
  if (existsSync(output) && !lstatSync(output).isDirectory()) {
    throw new Error(`The destination ${name} must be a plain directory.`);
  }
}
if (contains(destination, source)) throw new Error('Output must not contain the repository.');
// Validate the complete entry before removing an earlier output. The packager
// also refuses a stale inline bundle, remote references, and oversized images.
const bundle = verifyBundle();
const application = offlineFacts(join(source, 'app'));
const screenshots = screenshotFacts(join(source, 'screenshots'));
const studio = studioFacts();
const dossier = Buffer.from(buildDossier(source, CAPS));
if (dossier.length >= DOSSIER_BUDGET) throw new Error('dossier.json must be smaller than 1.5 MiB.');
const document = JSON.parse(dossier.toString('utf8'));
if (document.text.includes('[Cut at') || /lines not shown|whole files.*not shown/.test(document.text)) {
  throw new Error('All application source must fit in the dossier text budget.');
}
mkdirSync(destination, { recursive: true });
for (const name of ['app', 'screenshots']) {
  const output = join(destination, name);
  rmSync(output, { recursive: true, force: true });
  copyStaticTree(join(source, name), output);
}
const copied = Buffer.from(buildDossier(destination, CAPS));
if (!copied.equals(dossier)) throw new Error('Copied assets differ from the preflight dossier.');
writeFileSync(join(destination, 'dossier.json'), dossier);
if (!readFileSync(join(destination, 'dossier.json')).equals(dossier)) throw new Error('The dossier write was incomplete.');
console.log(JSON.stringify({
  ...application,
  bundleModules: bundle.modules,
  localEntry: bundle.localFileEntry,
  studio,
  dossierBytes: dossier.length,
  dossierHeadroomBytes: DOSSIER_BUDGET - dossier.length,
  dossierSHA256: sha256(dossier),
  screenshots: screenshots.map(({ name, width, height, bytes }) => ({ name, width, height, bytes })),
}, null, 2));
