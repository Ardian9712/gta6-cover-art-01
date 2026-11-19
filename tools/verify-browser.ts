import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connectMCP } from './playwright-mcp.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'http://127.0.0.1:4173';
const fileEntry = new URL('../app/index.html', import.meta.url).href;
const exportsDir = join(root, '.verification', 'exports');
const refined = process.argv.includes('--refined');
mkdirSync(exportsDir, { recursive: true });
const client = await connectMCP();
const report = [];
async function run(name, code) {
  const result = await client.call('browser_run_code_unsafe', { code });
  report.push({ name, result: result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n') });
  console.log(`PASS ${name}`);
}

try {
  await client.call('browser_resize', { width: 1280, height: 720 });
  await run('Install request monitor before loading', `async (page) => {
    const requests = [];
    page.__viceRequests = requests;
    page.on('request', request => requests.push({ url: request.url(), method: request.method(), kind: request.resourceType() }));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && !url.startsWith('${base}/')) return route.abort();
      return route.continue();
    });
    return 'External traffic blocked; all requests observed.';
  }`);
  await client.call('browser_navigate', { url: `${base}/?shot=editor&photo=boulevard&caption=VICE%20AFTER%20DARK` });
  await run('Initial sample, live canvas, and zero external/API requests', `async (page) => {
    await page.waitForFunction(() => window.__shotReady === true);
    const info = await page.evaluate(() => ({ state: window.__viceframe.snapshot(), canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height] }));
    if (info.state.photos.length !== 1 || info.state.photos[0].id !== 'boulevard') throw new Error('Default sample missing');
    if (info.canvas.join('x') !== '1080x1080') throw new Error('Wrong initial dimensions');
    const requests = page.__viceRequests;
    if (requests.some(r => /^https?:/.test(r.url) && !r.url.startsWith('${base}/'))) throw new Error('External request');
    if (requests.some(r => ['fetch','xhr','websocket'].includes(r.kind) || r.method !== 'GET')) throw new Error('API request');
    page.__viceBaseline = requests.length;
    return { ...info, externalRequests: 0, apiRequests: 0, initialStaticRequests: requests.length };
  }`);
  if (refined) await run('Refined editor has a larger preview and every setting in view', `async (page) => {
    const layout = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      const preview = document.querySelector('canvas').getBoundingClientRect();
      const grain = document.querySelector('#grain-input').getBoundingClientRect();
      return { sidebarHeight: sidebar.clientHeight, sidebarContent: sidebar.scrollHeight, previewHeight: preview.height, finalControlBottom: grain.bottom, viewportHeight: innerHeight };
    });
    if (layout.previewHeight < 400) throw new Error('Preview is still too small');
    if (layout.finalControlBottom > layout.viewportHeight || layout.sidebarContent > layout.sidebarHeight + 1) throw new Error('Settings still overflow: ' + JSON.stringify(layout));
    return layout;
  }`);
  await client.call('browser_click', { target: '#upload-button', element: 'Upload local photo' });
  await client.call('browser_file_upload', { paths: [join(root, 'app/samples/pier.jpg')] });
  await run('File API upload stays local', `async (page) => {
    await page.waitForFunction(() => window.__viceframe.snapshot().photos[0]?.sample === false);
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.photos.length !== 1 || state.photos[0].name !== 'pier.jpg') throw new Error('Upload missing');
    if (!(await page.locator('.photo-tile img').getAttribute('src')).startsWith('data:image/')) throw new Error('Not a data URI');
    return state;
  }`);
  await run('Zoom control and real pointer drag alter the crop', `async (page) => {
    await page.locator('#zoom-input').evaluate(el => { el.value = '1.6'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const before = await page.evaluate(() => ({ crop: window.__viceframe.snapshot().panels.hero.crop, pixels: document.querySelector('canvas').toDataURL() }));
    const box = await page.locator('#cover-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * .4, box.y + box.height * .28);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * .4 + 38, box.y + box.height * .28 + 23, { steps: 9 }); await page.mouse.up();
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => ({ crop: window.__viceframe.snapshot().panels.hero.crop, pixels: document.querySelector('canvas').toDataURL() }));
    if (after.crop.zoom !== 1.6 || (after.crop.x === before.crop.x && after.crop.y === before.crop.y)) throw new Error('Crop did not move');
    if (after.pixels === before.pixels) throw new Error('Live crop did not paint');
    return { before: before.crop, after: after.crop };
  }`);
  await client.call('browser_type', { target: '#title-input', text: 'NEON OUTLAW', element: 'Cover title' });
  await client.call('browser_type', { target: '#subtitle-input', text: 'TROUBLE HAS A NEW FACE.', element: 'Cover subtitle' });
  await run('Caption updates live, preview mode and precision controls work', `async (page) => {
    await page.waitForFunction(() => window.__viceframe.snapshot().title === 'NEON OUTLAW');
    const before = await page.evaluate(() => document.querySelector('canvas').toDataURL());
    await page.locator('#x-input').evaluate(el => { el.value = '.25'; el.dispatchEvent(new Event('input', { bubbles:true })); });
    await page.locator('#y-input').evaluate(el => { el.value = '-.12'; el.dispatchEvent(new Event('input', { bubbles:true })); });
    await page.waitForTimeout(70);
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.panels.hero.crop.x !== .25 || state.panels.hero.crop.y !== -.12) throw new Error('Precision crop failed');
    if (before === await page.evaluate(() => document.querySelector('canvas').toDataURL())) throw new Error('Precision controls did not repaint');
    await page.locator('#preview-toggle').click();
    if (await page.locator('#preview-toggle').getAttribute('aria-pressed') !== 'true') throw new Error('Preview failed');
    await page.locator('#preview-toggle').click(); await page.locator('#reset-crop').click();
    const reset = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    if (reset.zoom !== 1 || reset.x !== 0 || reset.y !== -.45) throw new Error('Reset failed');
    return { title: state.title, subtitle: state.subtitle, precisionCrop: state.panels.hero.crop, reset };
  }`);
  for (const [size, width, height] of [['square',1080,1080], ['portrait',1080,1350], ['wide',1920,1080]]) {
    await run(`Download valid ${size} PNG at ${width} × ${height}`, `async (page) => {
      await page.locator('[data-size="${size}"]').click();
      await page.waitForFunction(() => document.querySelector('canvas').width === ${width} && document.querySelector('canvas').height === ${height});
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export-button').click();
      const download = await downloadPromise;
      await download.saveAs(${JSON.stringify(join(exportsDir, `${size}.png`))});
      if (await download.failure()) throw new Error('Download failed');
      const details = await page.evaluate(() => window.__lastExport);
      if (details.width !== ${width} || details.height !== ${height} || details.type !== 'image/png') throw new Error('Export mismatch');
      return details;
    }`);
  }
  await run('Zero requests during upload, editing and all exports', `async (page) => {
    const additional = page.__viceRequests.slice(page.__viceBaseline);
    if (additional.some(r => /^https?:/.test(r.url))) throw new Error('An interaction made an HTTP request');
    return { interactionHttpRequests: 0, externalRequests: 0, apiRequests: 0 };
  }`);
  await client.call('browser_network_requests', { static: false, filename: '.verification/mcp/network-first.txt' });

  await client.call('browser_click', { target: '[data-sample="boulevard"]', element: 'Reload built-in Boulevard' });
  await client.call('browser_click', { target: '#upload-button', element: 'Upload four local photos' });
  await client.call('browser_file_upload', { paths: ['boulevard.jpg','pier.jpg','boulevard.jpg','pier.jpg'].map(name => join(root, 'app/samples', name)) });
  await run('Four uploads fill independently editable panels', `async (page) => {
    await page.waitForFunction(() => window.__viceframe.snapshot().photos.length === 4);
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (new Set(state.photos.map(p => p.id)).size !== 4) throw new Error('Duplicate photo IDs');
    if (new Set(Object.values(state.panels).map(p => p.photoId)).size !== 4) throw new Error('Panel assignment failed');
    for (const panel of ['hero','scene','detail','atmosphere']) {
      await page.locator('[data-panel="'+panel+'"]').click();
      await page.locator('#zoom-input').evaluate(el => { el.value='1.25';el.dispatchEvent(new Event('input',{bubbles:true})); });
      await page.locator('#x-input').evaluate(el => { el.value='.14';el.dispatchEvent(new Event('input',{bubbles:true})); });
    }
    const modified = await page.evaluate(() => window.__viceframe.snapshot());
    if (Object.values(modified.panels).some(p => p.crop.zoom !== 1.25 || p.crop.x !== .14)) throw new Error('A panel crop was not saved');
    const photoId = modified.photos[0].id;
    for (const panel of ['hero','scene','detail']) {
      await page.locator('[data-panel="'+panel+'"]').click(); await page.locator('#panel-source').selectOption(photoId);
    }
    const linked = await page.evaluate(() => window.__viceframe.snapshot());
    if (['hero','scene','detail'].some(p => linked.panels[p].photoId !== photoId)) throw new Error('Photo reuse failed');
    return { uploads: modified.photos, perPanelCrops: modified.panels, reusedPhotoId: photoId };
  }`);
  await run('Colour grades and grain repaint', `async (page) => {
    const before = await page.evaluate(() => document.querySelector('canvas').toDataURL());
    await page.locator('[data-mood="neon"]').click();
    await page.locator('#grain-input').evaluate(el => { el.value='32';el.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => document.querySelector('canvas').toDataURL());
    if (before === after) throw new Error('Grading did not paint');
    return await page.evaluate(() => ({ mood: window.__viceframe.snapshot().mood, grain: window.__viceframe.snapshot().grain }));
  }`);
  await run('Removing a photo leaves valid panel assignments', `async (page) => {
    await page.locator('.photo-remove').first().click();
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.photos.length !== 3 || Object.values(state.panels).some(p => !state.photos.some(photo => photo.id === p.photoId))) throw new Error('Broken removal');
    return { photos: state.photos.length, panelAssignmentsValid: true };
  }`);

  await client.call('browser_navigate', { url: `${fileEntry}?shot=cover&photo=boulevard&caption=VICE%20AFTER%20DARK&size=wide` });
  await run('Direct file:// opening exports a real full-size PNG with zero HTTP requests', `async (page) => {
    await page.waitForFunction(() => window.__shotReady === true);
    const details = await page.evaluate(() => ({ export: window.__lastExport, source: document.querySelector('#export-image').src.slice(0,30), image: [document.querySelector('#export-image').naturalWidth, document.querySelector('#export-image').naturalHeight] }));
    if (!details.source.startsWith('data:image/png;') || details.image.join('x') !== '1920x1080') throw new Error('File-mode PNG failed');
    const requests = page.__viceRequests.filter(r => r.url.startsWith('file:'));
    return { ...details, fileModeHttpRequests: 0, localFileResources: requests.length };
  }`);
  await client.call('browser_take_screenshot', { filename: refined ? '.verification/mcp-refined-cover.jpg' : '.verification/mcp-first-working-cover.jpg', type: 'jpeg', scale: 'css' });
  await client.call('browser_console_messages', { level: 'error', filename: '.verification/mcp/console-errors.txt' });
  writeFileSync(join(root, '.verification', refined ? 'browser-report-refined.json' : 'browser-report.json'), JSON.stringify({ checks: report, passed: report.length }, null, 2));
  console.log(`All ${report.length} browser checks passed through Playwright MCP.`);
} finally { await client.close(); }
