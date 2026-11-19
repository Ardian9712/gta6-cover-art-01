import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { sampleFacts, sha256 } from './artifact-facts.ts';

// A small, project-specific concatenation step, not a runtime dependency. The
// canonical sources are ES modules. A closed classic-script bundle supports
// file:// without module-import CORS and keeps duplicate generated code out of
// the dossier's limited source-text section.
export const root = new URL('../', import.meta.url);
const sources = ['state.js', 'history.js', 'renderer.js', 'editor.js'];
const runtimePath = 'app/studio.min.js';

export function bundledModule() {
  const body = sources.map((name) => {
    const text = readFileSync(new URL(`app/src/${name}`, root), 'utf8');
    const localImports = Array.from(text.matchAll(/^import .*? from ['"]([^'"]+)['"];$/gm));
    for (const [, specifier] of localImports) {
      if (!specifier.startsWith('./') || !sources.includes(specifier.slice(2))) {
        throw new Error(`The local-file bundle cannot resolve ${specifier} in ${name}.`);
      }
    }
    const code = text.replace(/^import .*?;\n/gm, '').replace(/^export (?=(?:async )?(?:function|const|class)\b)/gm, '');
    if (/^import\b|\bimport\(/m.test(code)) throw new Error(`Unbundled import in ${name}.`);
    return `// ---- Original source: src/${name} ----\n${code}`;
  }).join('\n');
  if (/<\/script/i.test(body)) throw new Error('A source closes its inline script.');
  return body;
}

export function bundledPhotos() {
  const localSamples = Object.fromEntries(['boulevard', 'pier'].map((name) => [name,
  `data:image/jpeg;base64,${readFileSync(new URL(`app/samples/${name}.jpg`, root)).toString('base64')}`,
  ]));
  const metadata = sampleFacts(fileURLToPath(root));
  const catalog = { version: 2, keys: Object.keys(metadata), mime: 'image/jpeg' };
  return `globalThis.__VICEFRAME_SAMPLE_DATA__=Object.freeze(${JSON.stringify(localSamples)});\n` +
    `globalThis.__VICEFRAME_SAMPLE_INFO__=Object.freeze(${JSON.stringify(metadata)});\n` +
    `globalThis.__VICEFRAME_SAMPLE_CATALOG__=Object.freeze(${JSON.stringify(catalog)});\n`;
}

export function bundledRuntime() {
  const code = `// Generated local entry. Edit the canonical modules in src/.\n(() => {\n'use strict';\n${bundledModule()}\n})();\n`;
  // Parse the exact classic-script bytes, including cross-module declarations.
  // No source is evaluated on the build machine and no minifier is downloaded.
  new Script(code, { filename: runtimePath });
  return code;
}

export function bundledHTML() {
  const html = readFileSync(new URL('app/index.html', root), 'utf8');
  const begin = '<!-- LOCAL_MODULE_BEGIN -->';
  const end = '<!-- LOCAL_MODULE_END -->';
  if (html.split(begin).length !== 2 || html.split(end).length !== 2) throw new Error('Expected one local module marker pair.');
  const start = html.indexOf(begin);
  const finish = html.indexOf(end);
  if (finish < start) throw new Error('Reversed local module markers.');
  return `${html.slice(0, start + begin.length)}\n<script defer src="./studio.min.js"></script>\n${html.slice(finish)}`;
}

export function verifyBundle() {
  const expectedHTML = bundledHTML();
  const expectedPhotos = bundledPhotos();
  const runtime = bundledRuntime();
  if (readFileSync(new URL('app/index.html', root), 'utf8') !== expectedHTML) throw new Error('The inline entry is stale. Run npm run bundle.');
  if (readFileSync(new URL('app/samples/offline-photos.min.js', root), 'utf8') !== expectedPhotos) throw new Error('The offline sample companion is stale.');
  if (readFileSync(new URL(runtimePath, root), 'utf8') !== runtime) throw new Error('The local classic-script entry is stale. Run npm run bundle.');
  return {
    modules: sources.length, runtime: runtimePath, runtimeBytes: Buffer.byteLength(runtime),
    runtimeSHA256: sha256(Buffer.from(runtime)), samples: 2, sampleCatalogVersion: 2,
    localFileEntry: 'deferred classic script',
  };
}

// This generated, minified data-only script contains the two permitted photos.
// Data origins avoid file:// image tainting and keep local-file PNG export valid.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--check')) {
    writeFileSync(new URL('app/index.html', root), bundledHTML());
    writeFileSync(new URL('app/samples/offline-photos.min.js', root), bundledPhotos());
    writeFileSync(new URL(runtimePath, root), bundledRuntime());
  }
  console.log(JSON.stringify(verifyBundle(), null, 2));
}
