import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier, readAppTree } from '../vendor/makefun-app.ts';
import { CAPS, DOSSIER_BUDGET, offlineFacts, screenshotFacts, studioFacts, kitCopyFacts, sha256 } from './artifact-facts.ts';
import { verifyBundle } from './bundle.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const first = resolve(root, process.argv[2] || '.verification/pass-2/output-a');
const second = resolve(root, process.argv[3] || '.verification/pass-2/output-b');
const caps = CAPS;

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
  if (item.path.startsWith('app/') || item.path.startsWith('screenshots/')) {
    if (!left.equals(readFileSync(join(root, item.path)))) throw new Error(`Packaging changed source bytes: ${item.path}`);
  }
}
for (const output of [first, second]) {
  const dossier = readFileSync(join(output, 'dossier.json'));
  if (dossier.length >= DOSSIER_BUDGET) throw new Error('Dossier is not under 1.5 MiB.');
  if (!dossier.equals(Buffer.from(buildDossier(output, caps)))) throw new Error('Dossier does not match the official API.');
  const document = JSON.parse(dossier.toString('utf8'));
  if (document.images.length !== 4 || document.images[0].name !== '1-cover.jpg') throw new Error('Wrong dossier screenshots.');
  if (Buffer.byteLength(document.text) > caps.text_max_bytes) throw new Error('Dossier text cap exceeded.');
  if (document.text.includes('[Cut at')) throw new Error('Original application source was cut out of the dossier.');
  if (readFileSync(join(output, 'app/index.html')).length > 1048576) throw new Error('index.html is too large.');
}
if (a.length > 1000) throw new Error('Output exceeds the platform entry cap.');
const bundle = verifyBundle();
const offline = offlineFacts(join(first, 'app'));
const images = screenshotFacts(join(first, 'screenshots'));
const capture = JSON.parse(readFileSync(join(root, '.verification', 'pass-2', 'screenshot-evidence.json'), 'utf8'));
const browser = JSON.parse(readFileSync(join(root, '.verification', 'pass-2', 'browser-report.json'), 'utf8'));
if (capture.pass !== 2 || capture.networkRequests || capture.browserErrors) throw new Error('Screenshot evidence is not from a clean pass-2 capture.');
if (browser.passed < 45 || browser.combinations !== 25 || browser.networkRequests || browser.browserErrors) throw new Error('Extended browser verification is incomplete.');
if (capture.sourceAppSHA256 !== offline.appSHA256 || browser.sourceAppSHA256 !== offline.appSHA256) throw new Error('Browser evidence does not verify the packaged application bytes.');
for (const image of images) {
  const recorded = capture.screenshots.find((item) => item.name === image.name);
  if (!recorded || recorded.pass !== 2 || recorded.sha256 !== image.sha256) throw new Error(`Screenshot is not the recorded pass-2 capture: ${image.name}`);
}

const kit = '/home/hatch/workspace/makefun/gta6-cover-art-01-kit/gta6-cover-art-01-kit/starter';
const kitCopies = kitCopyFacts(root, kit);
if (!readFileSync(join(root, 'LICENSE'), 'utf8').startsWith('SPDX-License-Identifier: MIT\n')) throw new Error('Wrong license first line.');

const app = readAppTree(join(first, 'app'), caps);
const dossier = readFileSync(join(first, 'dossier.json'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const bounty = 'https://make.fun/bounty/gta6-cover-art-01';
const badges = [
  'https://make.fun/badge/gta6-cover-art-01.svg',
  'https://make.fun/badge/gta6-cover-art-01/Ardian9712/gta6-cover-art-01/rank.svg',
  'https://make.fun/badge/gta6-cover-art-01/Ardian9712/gta6-cover-art-01/reward.svg',
];
const badgeLines = readme.split('\n').slice(0, 3);
for (const [index, url] of badges.entries()) {
  if (!badgeLines[index].includes(`](${url})](${bounty})`)) throw new Error(`Missing live linked badge: ${url}`);
}
if (!readme.includes('https://make.fun/r/p8atzycs')) throw new Error('The referral footer is missing.');
const outputFingerprint = sha256(Buffer.from(a.filter(item => item.type === 'file').map(item =>
  `${item.path}\0${sha256(readFileSync(join(first, item.path)))}`).join('\n')));
const summary = {
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
  dossierBudgetBytes: DOSSIER_BUDGET,
  appBudgetBytes: CAPS.app_max_bytes,
  appEntryBudget: CAPS.app_max_files,
  sourceAssetsByteIdentical: true,
  studio: studioFacts(),
  browserChecksPassed: browser.passed,
  browserAndCaptureVerifyCurrentBytes: true,
  kitCopies,
  outputSHA256: outputFingerprint,
  bundle,
  offline,
  vendorSHA256: sha256(readFileSync(join(root, 'vendor/makefun-app.ts'))),
  liveBadges: 3,
  referralFooter: true,
  screenshotCaptureHashesMatch: true,
  screenshots: images.map(({name,width,height,bytes}) => ({name,width,height,bytes})),
};
writeFileSync(join(root, '.verification', 'pass-2', 'package-report.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
