import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// This pass starts at the explicitly requested baseline commit. Generated
// artifacts are visible in Git totals and excluded from the independent novel
// source audit, so a relocated bundle cannot substitute for new implementation.
const BASE = process.argv[2] || '46d605e694f1f3f95ed4295b7b233e88987b700b';
const root = fileURLToPath(new URL('../', import.meta.url));
const OWNED = Object.freeze([
  '.gitignore', 'LICENSE', 'README.md', 'app/index.html',
  'app/samples/offline-photos.min.js', 'app/src/editor.js',
  'app/src/renderer.js', 'app/src/state.js', 'app/src/history.js',
  'app/style.css', 'main.ts', 'package.json', 'serve.ts',
  'tools/bundle.ts', 'tools/capture-screenshots.ts', 'tools/playwright-mcp.ts',
  'tools/validate-images.py', 'tools/verify-browser.ts', 'tools/verify-package.ts',
  'tools/artifact-facts.ts', 'tools/audit-authorship.ts',
]);
const SAMPLES = new Set(['app/samples/boulevard.jpg', 'app/samples/pier.jpg']);
const GENERATED = new Set(['app/studio.min.js', 'app/samples/offline-photos.min.js']);
const EVIDENCE = join(root, '.verification', 'pass-2');

function git(args, binary = false) {
  const result = spawnSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8') || `Git failed: ${args.join(' ')}`);
  return binary ? result.stdout : result.stdout.toString('utf8');
}

function lines(text) {
  if (!text) return 0;
  return text.split('\n').length - Number(text.endsWith('\n'));
}

function primary(path, text) {
  if (GENERATED.has(path)) return '';
  if (path !== 'app/index.html') return text;
  return text.replace(/<!-- LOCAL_MODULE_BEGIN -->[\s\S]*?<!-- LOCAL_MODULE_END -->/, '<!-- Generated entry excluded -->');
}

function novelLines(before, after) {
  const old = new Map();
  for (const line of before.split('\n').map(line => line.trim()).filter(Boolean)) old.set(line, (old.get(line) || 0) + 1);
  let count = 0;
  for (const line of after.split('\n').map(line => line.trim()).filter(Boolean)) {
    const available = old.get(line) || 0;
    if (available) old.set(line, available - 1);
    else count++;
  }
  return count;
}

// Git records +/- lines, not a semantic "modified" count. Pair replacements
// inside each zero-context hunk; unmatched + lines are additions. Their sum is
// exactly the positive column of git diff --numstat <baseline-sha>.
function replacements(path) {
  const diff = git(['diff', '--no-ext-diff', '--no-renames', '--unified=0', BASE, '--', path]);
  let additions = 0;
  let removals = 0;
  let modified = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      modified += Math.min(additions, removals);
      additions = 0; removals = 0; inHunk = true;
    } else if (inHunk && line.startsWith('+')) additions++;
    else if (inHunk && line.startsWith('-')) removals++;
  }
  return modified + Math.min(additions, removals);
}

git(['rev-parse', '--verify', `${BASE}^{commit}`]);
const baselinePaths = new Set(git(['ls-tree', '-r', '--name-only', '-z', BASE]).split('\0').filter(Boolean));
const currentPaths = new Set([
  ...git(['ls-files', '-z']).split('\0'),
  ...git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
].filter(Boolean));
const numstat = git(['diff', '--numstat', BASE]);
const stats = new Map(numstat.trim().split('\n').filter(Boolean).map(line => {
  const [plus, minus, path] = line.split('\t');
  return [path, { inserted: plus === '-' ? 0 : Number(plus), removed: minus === '-' ? 0 : Number(minus), binary: plus === '-' }];
}));
const isProtected = path => path.startsWith('vendor/') || path.split('/').at(-1) === 'makefun-app.ts' || SAMPLES.has(path);
const protectedPaths = [...new Set([...baselinePaths, ...currentPaths])].filter(isProtected).sort();
for (const path of protectedPaths) {
  if (!baselinePaths.has(path) || !currentPaths.has(path)) throw new Error(`Protected file was added or removed: ${path}`);
  if (!git(['show', `${BASE}:${path}`], true).equals(readFileSync(join(root, path)))) throw new Error(`Protected bytes changed: ${path}`);
}
if (OWNED.length !== 21) throw new Error('The ownership contract must list exactly 21 required text files.');
for (const path of OWNED) {
  if (!currentPaths.has(path) || !stats.get(path)?.inserted) throw new Error(`Required owned file has no new line: ${path}`);
}

let repositoryLines = 0;
let ownedLines = 0;
let primaryLines = 0;
let primaryNovelLines = 0;
const files = [];
for (const path of [...currentPaths].sort()) {
  const bytes = readFileSync(join(root, path));
  const binary = /\.(?:jpg|jpeg|png|webp)$/i.test(path) || bytes.includes(0);
  const text = binary ? '' : bytes.toString('utf8');
  const total = lines(text);
  repositoryLines += total;
  if (isProtected(path)) continue;
  ownedLines += total;
  const before = baselinePaths.has(path) ? git(['show', `${BASE}:${path}`]) : '';
  const source = primary(path, text);
  primaryLines += source.split('\n').filter(line => line.trim()).length;
  primaryNovelLines += novelLines(primary(path, before), source);
  const stat = stats.get(path);
  if (!stat) {
    if (!baselinePaths.has(path)) throw new Error(`Include new file in numstat with git add -N: ${path}`);
    continue;
  }
  const modified = binary ? 0 : replacements(path);
  files.push({
    path, requiredOwnedFile: OWNED.includes(path), generated: GENERATED.has(path),
    binary, newFile: !baselinePaths.has(path),
    added: stat.inserted - modified, modified,
    addedPlusModified: stat.inserted, removed: stat.removed,
    deletedWithoutReplacement: stat.removed - modified, finalLines: total,
  });
}

const added = files.reduce((total, file) => total + file.added, 0);
const modified = files.reduce((total, file) => total + file.modified, 0);
const removed = files.reduce((total, file) => total + file.removed, 0);
const newLines = added + modified;
const overallShare = newLines / repositoryLines * 100;
const ownedShare = newLines / ownedLines * 100;
const primaryShare = primaryNovelLines / primaryLines * 100;
const requiredFiles = files.filter(file => file.requiredOwnedFile);
const requiredFinalLines = requiredFiles.reduce((total, file) => total + file.finalLines, 0);
const requiredNewLines = requiredFiles.reduce((total, file) => total + file.addedPlusModified, 0);
if (requiredNewLines / requiredFinalLines < .30) throw new Error('The 21 required files must independently clear 30%.');
if (overallShare < 30) throw new Error(`New-line share including the kit helper is only ${overallShare.toFixed(2)}%.`);
if (primaryShare < 30) throw new Error(`Independent novel-source share is only ${primaryShare.toFixed(2)}%.`);
const screenshots = files.filter(file => file.binary);
if (screenshots.length !== 4 || screenshots.some(file => !file.path.startsWith('screenshots/'))) throw new Error('All four screenshots must be retaken.');

const report = {
  baseline: BASE,
  numstatCommand: `git diff --numstat ${BASE}`,
  modifiedCountingMethod: 'paired +/- lines within each zero-context hunk',
  requiredOwnedTextFiles: OWNED.length,
  changedTextFiles: files.filter(file => !file.binary).length,
  everyRequiredOwnedFileHasNewLines: true,
  requiredFileAddedLines: requiredFiles.reduce((total, file) => total + file.added, 0),
  requiredFileModifiedLines: requiredFiles.reduce((total, file) => total + file.modified, 0),
  requiredFileAddedPlusModifiedLines: requiredNewLines,
  requiredFileFinalLines: requiredFinalLines,
  requiredFileNewLineSharePercent: Number((requiredNewLines / requiredFinalLines * 100).toFixed(2)),
  addedLines: added,
  modifiedLines: modified,
  addedPlusModifiedLines: newLines,
  removedLines: removed,
  finalOwnedTextLines: ownedLines,
  finalRepositoryTextLinesIncludingHelper: repositoryLines,
  overallNewLineSharePercent: Number(overallShare.toFixed(2)),
  ownedNewLineSharePercent: Number(ownedShare.toFixed(2)),
  primaryNovelNonblankLines: primaryNovelLines,
  primaryFinalNonblankLines: primaryLines,
  primaryNovelSharePercent: Number(primaryShare.toFixed(2)),
  generatedRuntimeAndPhotoDataExcludedFromPrimaryShare: true,
  untouchedProtectedFiles: protectedPaths,
  retakenScreenshots: screenshots.length,
  files,
  numstat,
};
mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(join(EVIDENCE, 'authorship-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
