import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { readAppTree } from '../vendor/makefun-app.ts';
import { SIZES, GRADES, EXPORT_ENCODINGS, JPEG_QUALITIES, RECENT_EXPORT_LIMIT, NUMBER_CONTROLS } from '../app/src/state.js';

export const CAPS = Object.freeze({
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
});
export const DOSSIER_BUDGET = 1572864;
export const SCREENSHOT_NAMES = Object.freeze([
  '1-cover.jpg', '2-editor.jpg', '3-cover-portrait.jpg', '4-cover-wide.jpg',
]);
export const SCREENSHOT_DIMENSIONS = Object.freeze({
  '1-cover.jpg': [720, 1280],
  '2-editor.jpg': [1280, 720],
  '3-cover-portrait.jpg': [800, 1000],
  '4-cover-wide.jpg': [1280, 720],
});
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function appFingerprint(directory) {
  const tree = readAppTree(directory, CAPS);
  const manifest = tree.files.map(file => `${file.path}\0${sha256(readFileSync(join(directory, file.path)))}`).sort().join('\n');
  return sha256(Buffer.from(manifest));
}

export function imageFacts(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Incomplete PNG header.');
    return { format: 'PNG', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
  }
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Expected a PNG or JPEG image.');
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) throw new Error('Malformed JPEG marker.');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG segment.');
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) throw new Error('Incomplete JPEG frame.');
      return { format: 'JPEG', width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3), bytes: bytes.length };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions were not found.');
}

export function screenshotFacts(directory, exactNames = true) {
  const names = readdirSync(directory).sort();
  if (exactNames && JSON.stringify(names) !== JSON.stringify(SCREENSHOT_NAMES)) {
    throw new Error(`Expected exactly four named screenshots; found ${names.join(', ')}.`);
  }
  return names.map((name) => {
    const bytes = readFileSync(join(directory, name));
    const facts = imageFacts(bytes);
    if (facts.bytes > CAPS.screenshots.max_bytes) throw new Error(`${name}: exceeds 256 KiB.`);
    if (Math.max(facts.width, facts.height) > 1280 || Math.min(facts.width, facts.height) < 480) {
      throw new Error(`${name}: ${facts.width} × ${facts.height} does not fit the screenshot limits.`);
    }
    const expected = SCREENSHOT_DIMENSIONS[name];
    if (expected && (facts.width !== expected[0] || facts.height !== expected[1])) {
      throw new Error(`${name}: expected ${expected.join(' × ')}, got ${facts.width} × ${facts.height}.`);
    }
    return { name, ...facts, sha256: sha256(bytes) };
  });
}

export function offlineFacts(directory) {
  const tree = readAppTree(directory, CAPS);
  const namespace = 'http://www.w3.org/2000/svg';
  let textFilesChecked = 0;
  let xmlNamespaces = 0;
  for (const file of tree.files) {
    if (!['.html', '.js', '.mjs', '.css', '.json', '.svg'].includes(extname(file.path))) continue;
    textFilesChecked++;
    const original = readFileSync(join(directory, file.path), 'utf8');
    xmlNamespaces += original.split(namespace).length - 1;
    const text = original.replaceAll(namespace, 'SVG_XML_NAMESPACE');
    const remote = /(?:https?|wss?|ftp):\/\/|(?:src|href)\s*=\s*["']\/\/|url\(\s*["']?\/\//i;
    if (remote.test(text)) throw new Error(`Network reference in app/${file.path}.`);
    const networkAPI = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\.sendBeacon\s*\(|serviceWorker\.register\s*\(/;
    if (networkAPI.test(text)) throw new Error(`Network API in app/${file.path}.`);
  }
  const html = readFileSync(join(directory, 'index.html'), 'utf8');
  if (!html.includes("connect-src 'none'")) throw new Error('The local-only connection policy is missing.');
  if (!/<link\s+rel="icon"\s+href="data:image\/svg\+xml,/.test(html)) throw new Error('Expected the inline data favicon.');
  if (!html.includes('<script defer src="./studio.min.js"></script>')) throw new Error('The direct-file classic-script entry is missing.');
  return {
    appFiles: tree.files.length,
    appDirectories: tree.directories.length,
    appEntries: tree.count,
    appBytes: tree.totalBytes,
    textFilesChecked,
    xmlNamespaces,
    networkReferences: 0,
    networkAPIs: 0,
    connectionPolicy: 'none',
    appSHA256: appFingerprint(directory),
  };
}

export function studioFacts() {
  const formats = Object.entries(SIZES).map(([key, value]) => ({ key, ...value }));
  const grades = Object.entries(GRADES).map(([key, { name }]) => ({ key, name }));
  if (formats.length < 5 || grades.length < 5) throw new Error('Revision 2 needs five formats and five grades.');
  if (new Set(formats.map(({ width, height }) => `${width}x${height}`)).size !== formats.length) {
    throw new Error('A format is only an alias for an existing output size.');
  }
  return {
    revision: 2, formats, grades,
    encodings: Object.values(EXPORT_ENCODINGS).map(({ mime }) => mime),
    jpegQualities: [...JPEG_QUALITIES],
    controls: NUMBER_CONTROLS,
    recentExportLimit: RECENT_EXPORT_LIMIT,
    comparison: 'original-left / graded-right, editor only',
    shortcutKeys: ['G', 'F', 'H', 'C', 'Control+S', 'Meta+S'],
  };
}

export function kitCopyFacts(root, kit) {
  const paths = ['vendor/makefun-app.ts', 'app/samples/boulevard.jpg', 'app/samples/pier.jpg'];
  return paths.map((path) => {
    const source = readFileSync(join(root, path));
    if (!source.equals(readFileSync(join(kit, path)))) throw new Error(`Required kit bytes changed: ${path}`);
    return { path, bytes: source.length, sha256: sha256(source), byteIdentical: true };
  });
}

export function sampleFacts(root) {
  return Object.fromEntries(['boulevard', 'pier'].map((key) => {
    const bytes = readFileSync(join(root, 'app', 'samples', `${key}.jpg`));
    const { width, height } = imageFacts(bytes);
    return [key, {
      name: key === 'pier' ? 'The pier' : 'Boulevard',
      width, height, bytes: bytes.length, sha256: sha256(bytes),
    }];
  }));
}
