import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connectMCP } from './playwright-mcp.ts';
import { CAPS, appFingerprint, imageFacts, screenshotFacts, sha256 } from './artifact-facts.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = new URL('../app/index.html', import.meta.url).href;
const shots = [
  { name: '1-cover.jpg', width: 720, height: 1280, mode: 'cover', photo: 'boulevard', caption: 'VICE AFTER DARK', subtitle: 'THE NIGHT IS YOURS. MAKE IT COUNT.', size: 'story', mood: 'vice', grain: '12', intensity: 100, textScale: 100, sublineSize: 16, natural: [1080,1920] },
  { name: '2-editor.jpg', width: 1280, height: 720, mode: 'editor', photo: 'boulevard', caption: 'NEON OUTLAW', subtitle: 'MAKE WAVES. MAKE YOUR OWN RULES.', size: 'square', mood: 'vice', grain: '14', intensity: 75, textScale: 90, sublineSize: 18, upload: 'pier.jpg' },
  { name: '3-cover-portrait.jpg', width: 800, height: 1000, mode: 'cover', photo: 'pier', caption: 'PARADISE MOST WANTED', subtitle: 'TROUBLE FINDS ITS WAY TO PARADISE.', size: 'portrait', mood: 'coast', grain: '12', intensity: 85, textScale: 92, sublineSize: 18, natural: [1080,1350] },
  { name: '4-cover-wide.jpg', width: 1280, height: 720, mode: 'cover', photo: 'boulevard', caption: 'NO RULES JUST SUNSET', subtitle: 'LIVE FAST. STAY GOLD.', size: 'wide', mood: 'sunset', grain: '14', intensity: 85, textScale: 95, sublineSize: 16, natural: [1920,1080] },
];
const client = await connectMCP('screenshots');
const sourceAppSHA256 = appFingerprint(join(root, 'app'));
const evidence = [];
try {
  await client.call('browser_run_code_unsafe', { code: `async (page) => {
    page.__captureNetwork = []; page.__captureErrors = [];
    page.on('request', request => { if (/^(https?|wss?|ftp):/.test(request.url())) page.__captureNetwork.push(request.url()); });
    page.on('pageerror', error => page.__captureErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') page.__captureErrors.push(message.text()); });
    await page.route('**/*', route => /^(https?|wss?|ftp):/.test(route.request().url()) ? route.abort() : route.continue());
    return 'Capture monitor installed before any app navigation.';
  }` });
  for (const shot of shots) {
    await client.call('browser_resize', { width: shot.width, height: shot.height });
    const params = new URLSearchParams({ shot: shot.mode, photo: shot.photo, caption: shot.caption, size: shot.size, mood: shot.mood, grain: shot.grain, intensity: String(shot.intensity), textScale: String(shot.textScale), sublineSize: String(shot.sublineSize) });
    if (shot.subtitle) params.set('subtitle', shot.subtitle);
    if (shot.mode === 'editor') {
      params.set('compare','1'); params.set('split','42');
      params.set('encoding','jpeg'); params.set('quality','85');
    }
    await client.call('browser_navigate', { url: `${entry}?${params}` });
    if (shot.upload) {
      await client.call('browser_click', { target: '#upload-button', element: 'Load a local kit photo into the editor for the genuine screenshot' });
      await client.call('browser_file_upload', { paths: [join(root, 'app', 'samples', shot.upload)] });
    }
    const result = await client.call('browser_run_code_unsafe', { code: `async (page) => {
      await page.waitForFunction(() => window.__shotReady === true);
      ${shot.mode === 'cover' ? `
      const info = await page.evaluate(() => ({ source: document.querySelector('#export-image').src.slice(0,25), natural: [document.querySelector('#export-image').naturalWidth, document.querySelector('#export-image').naturalHeight], exported: window.__lastExport }));
      if (!info.source.startsWith('data:image/png;') || info.natural.join('x') !== '${shot.natural.join('x')}') throw new Error('Screenshot is not the app’s exported PNG');
      if (info.exported.intensity !== ${shot.intensity} || info.exported.textScale !== ${shot.textScale} || info.exported.sublineSize !== ${shot.sublineSize}) throw new Error('Cover screenshot has stale revision settings');
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
      await page.waitForFunction(() => window.__viceframe.snapshot().photos[0]?.sample === false);
      await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('visible'));
      const state = await page.evaluate(() => window.__viceframe.snapshot());
      if (state.photos[0].name !== '${shot.upload}' || state.mood !== 'vice' || state.intensity !== 75 || state.textScale !== 90 || state.sublineSize !== 18) throw new Error('Editor screenshot needs its actual uploaded photo and new controls');
      if (!state.compareEnabled || state.comparePosition !== 42 || state.exportType !== 'jpeg' || state.jpegQuality !== 85) throw new Error('New comparison or export features are not visible');
      if (!(await page.locator('.photo-tile img').getAttribute('src')).startsWith('data:image/')) throw new Error('Photo did not stay local');
      for (const id of ['intensity-input','text-scale-input','subline-size-input','compare-handle','jpeg-quality']) {
        const box=await page.locator('#'+id).boundingBox();
        if (!box || box.x<0 || box.y<0 || box.x+box.width>1280 || box.y+box.height>720) throw new Error('Pass-2 control is outside the editor screenshot: '+id);
      }
      await page.mouse.move(0,0);
      return { state, loadedPhoto: true };
      `}
    }` });
    // The actual Playwright MCP screenshot tool captures the displayed exported
    // PNG or the complete editor. Only the browser's proportional fit scales it.
    // No image is edited, composited, or re-encoded by a postprocessing script.
    await client.call('browser_take_screenshot', { filename: `screenshots/${shot.name}`, type: 'jpeg', scale: 'css' });
    const path = join(root, 'screenshots', shot.name);
    let bytes = readFileSync(path);
    let facts = imageFacts(bytes);
    let quality = null;
    // If the browser's default JPEG is too large, capture the page again with
    // a lower encoder quality. No existing screenshot is ever transformed.
    for (const candidate of [80, 72, 64, 56]) {
      if (facts.bytes <= CAPS.screenshots.max_bytes) break;
      await client.call('browser_run_code_unsafe', { code: `async (page) => {
        await page.screenshot({ path:${JSON.stringify(path)}, type:'jpeg', quality:${candidate}, scale:'css' });
        return { recaptured:true, quality:${candidate}, viewport:page.viewportSize() };
      }` });
      quality = candidate;
      bytes = readFileSync(path);
      facts = imageFacts(bytes);
    }
    if (facts.width !== shot.width || facts.height !== shot.height || facts.bytes > CAPS.screenshots.max_bytes) throw new Error(`Screenshot still fails its limits: ${shot.name}`);
    evidence.push({
      name: shot.name, ...facts, sha256: sha256(bytes), recaptureQuality: quality,
      pass: 2, view: { format:shot.size, grade:shot.mood, intensity:shot.intensity, headlineScale:shot.textScale, sublineSize:shot.sublineSize },
      visibleNewFeatures: shot.mode === 'editor' ? ['Neon Vice','75% intensity','headline/subline sizing','42% split comparison','JPEG / 85% quality','3:1 Banner option'] : ['grade intensity','headline/subline sizing'],
      source: shot.mode === 'cover' ? 'app-exported PNG, fitted by the browser' : 'editor with a File API upload',
      result: result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'),
    });
    console.log(`Playwright MCP captured screenshots/${shot.name}: ${facts.width} × ${facts.height}, ${facts.bytes} bytes.`);
  }
  await client.call('browser_run_code_unsafe', { code: `async (page) => {
    if (page.__captureNetwork.length || page.__captureErrors.length) throw new Error(JSON.stringify({network:page.__captureNetwork,errors:page.__captureErrors}));
    return {networkRequests:0,browserErrors:0,screenshots:4};
  }` });
  const verified = screenshotFacts(join(root, 'screenshots'));
  if (appFingerprint(join(root, 'app')) !== sourceAppSHA256) throw new Error('Application changed while screenshots were captured.');
  writeFileSync(join(root, '.verification', 'pass-2', 'screenshot-evidence.json'), JSON.stringify({ pass:2, sourceAppSHA256, screenshots:evidence, verified, networkRequests:0, browserErrors:0 }, null, 2));
  await client.call('browser_network_requests', { static:true, filename:join(client.output, 'network-requests.txt') });
} finally { await client.close(); }
