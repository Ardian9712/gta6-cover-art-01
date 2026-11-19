import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A small, project-specific concatenation step, not a runtime dependency. The
// canonical sources are ES modules. Inlining their entry also makes file:// work
// in browsers that refuse external module imports from a local file origin.
const root = new URL('../', import.meta.url);
const localSamples = Object.fromEntries(['boulevard', 'pier'].map((name) => [name,
  `data:image/jpeg;base64,${readFileSync(new URL(`app/samples/${name}.jpg`, root)).toString('base64')}`,
]));
// This generated, minified data-only script contains the two permitted photos.
// Data origins avoid file:// image tainting and keep local-file PNG export valid.
writeFileSync(new URL('app/samples/offline-photos.min.js', root),
  `globalThis.__VICEFRAME_SAMPLE_DATA__=Object.freeze(${JSON.stringify(localSamples)});\n`);
const sources = ['state.js', 'renderer.js', 'editor.js'];
const code = sources.map((name) => {
  const text = readFileSync(new URL(`app/src/${name}`, root), 'utf8');
  return `// ---- Original source: src/${name} ----\n${text
    .replace(/^import .*?;\n/gm, '')
    .replace(/^export (?=(?:async )?(?:function|const|class)\b)/gm, '')}`;
}).join('\n');
if (code.includes('</script')) throw new Error('An inline module cannot contain a closing script tag.');
const entry = new URL('app/index.html', root);
const html = readFileSync(entry, 'utf8');
const begin = '<!-- LOCAL_MODULE_BEGIN -->';
const end = '<!-- LOCAL_MODULE_END -->';
const start = html.indexOf(begin);
const finish = html.indexOf(end);
if (start < 0 || finish < start) throw new Error('Missing local module markers.');
const output = `${html.slice(0, start + begin.length)}\n<script type="module">\n${code}\n</script>\n${html.slice(finish)}`;
writeFileSync(fileURLToPath(entry), output);
console.log(`Inlined ${sources.length} original ES modules (${Buffer.byteLength(code)} bytes).`);
