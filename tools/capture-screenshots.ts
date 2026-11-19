import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connectMCP } from './playwright-mcp.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = new URL('../app/index.html', import.meta.url).href;
const shots = [
  { name: '1-cover.jpg', width: 1280, height: 720, mode: 'cover', photo: 'boulevard', caption: 'VICE AFTER DARK', size: 'wide', natural: [1920,1080] },
  { name: '2-editor.jpg', width: 1280, height: 720, mode: 'editor', photo: 'boulevard', caption: 'VICE AFTER DARK', size: 'wide' },
  { name: '3-cover-portrait.jpg', width: 800, height: 1000, mode: 'cover', photo: 'pier', caption: 'PARADISE MOST WANTED', subtitle: 'TROUBLE FINDS ITS WAY TO PARADISE.', size: 'portrait', natural: [1080,1350] },
  { name: '4-cover-wide.jpg', width: 1280, height: 720, mode: 'cover', photo: 'boulevard', caption: 'NO RULES JUST SUNSET', subtitle: 'LIVE FAST. STAY GOLD.', size: 'wide', natural: [1920,1080] },
];
const client = await connectMCP();
const evidence = [];
try {
  for (const shot of shots) {
    await client.call('browser_resize', { width: shot.width, height: shot.height });
    const params = new URLSearchParams({ shot: shot.mode, photo: shot.photo, caption: shot.caption, size: shot.size });
    if (shot.subtitle) params.set('subtitle', shot.subtitle);
    await client.call('browser_navigate', { url: `${entry}?${params}` });
    const result = await client.call('browser_run_code_unsafe', { code: `async (page) => {
      await page.waitForFunction(() => window.__shotReady === true);
      ${shot.mode === 'cover' ? `
      const info = await page.evaluate(() => ({ source: document.querySelector('#export-image').src.slice(0,25), natural: [document.querySelector('#export-image').naturalWidth, document.querySelector('#export-image').naturalHeight], exported: window.__lastExport }));
      if (!info.source.startsWith('data:image/png;') || info.natural.join('x') !== '${shot.natural.join('x')}') throw new Error('Screenshot is not the app’s exported PNG');
      const hash = () => page.evaluate(async () => {
        const { blob } = await window.__viceframe.exportPNG();
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
      });
      const before = await hash(); await page.reload(); await page.waitForFunction(() => window.__shotReady === true);
      const after = await hash();
      if (before !== after) throw new Error('Shot export is not deterministic');
      await page.mouse.move(0,0);
      return { ...info, repeatExportIdentical: true, sha256: after };
      ` : `
      const state = await page.evaluate(() => window.__viceframe.snapshot());
      if (!state.photos.length || state.photos[0].id !== 'boulevard') throw new Error('Editor screenshot needs a loaded photo');
      await page.mouse.move(0,0);
      return { state, loadedPhoto: true };
      `}
    }` });
    evidence.push({ name: shot.name, result: result.content.filter(item => item.type === 'text').map(item => item.text).join('\n') });
    // The actual Playwright MCP screenshot tool captures the displayed exported
    // PNG or the complete editor. Only the browser's proportional fit scales it.
    // No image is edited, composited, or re-encoded by a postprocessing script.
    await client.call('browser_take_screenshot', { filename: `screenshots/${shot.name}`, type: 'jpeg', scale: 'css' });
    console.log(`Playwright MCP captured screenshots/${shot.name} (${shot.width} × ${shot.height}).`);
  }
  writeFileSync(join(root, '.verification', 'screenshot-evidence.json'), JSON.stringify(evidence, null, 2));
} finally { await client.close(); }
