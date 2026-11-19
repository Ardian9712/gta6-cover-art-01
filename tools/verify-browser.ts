import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { connectMCP } from './playwright-mcp.ts';
import { SIZES, GRADES, JPEG_QUALITIES } from '../app/src/state.js';
import { appFingerprint, sha256 } from './artifact-facts.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fileEntry = new URL('../app/index.html', import.meta.url).href;
const exportsDir = join(root, '.verification', 'pass-2', 'exports');
const formatKeys = Object.keys(SIZES);
const gradeKeys = Object.keys(GRADES);
const sourceAppSHA256 = appFingerprint(join(root, 'app'));
mkdirSync(exportsDir, { recursive: true });
const client = await connectMCP('feature-checks');
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
    page.__viceErrors = [];
    page.on('pageerror', error => page.__viceErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') page.__viceErrors.push(message.text()); });
    page.on('request', request => requests.push({ url: request.url(), method: request.method(), kind: request.resourceType() }));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (/^(https?|wss?|ftp):/.test(url)) return route.abort();
      return route.continue();
    });
    page.__paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    page.__range = async (id, value) => {
      await page.locator('#' + id).evaluate((el, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await page.__paint();
    };
    page.__exportHash = () => page.evaluate(async () => {
      const { blob } = await window.__viceframe.exportPNG();
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    });
    return 'External traffic blocked; all requests observed.';
  }`);
  await client.call('browser_navigate', { url: `${fileEntry}?shot=editor&photo=boulevard&caption=VICE%20AFTER%20DARK` });
  await run('Initial sample, live canvas, and zero external/API requests', `async (page) => {
    await page.waitForFunction(() => window.__shotReady === true);
    const info = await page.evaluate(() => ({ state: window.__viceframe.snapshot(), canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height] }));
    if (info.state.photos.length !== 1 || info.state.photos[0].id !== 'boulevard') throw new Error('Default sample missing');
    if (info.canvas.join('x') !== '1080x1080') throw new Error('Wrong initial dimensions');
    const requests = page.__viceRequests;
    if (requests.some(r => /^(https?|wss?|ftp):/.test(r.url))) throw new Error('Network request');
    if (requests.some(r => ['fetch','xhr','websocket'].includes(r.kind) || r.method !== 'GET')) throw new Error('API request');
    page.__viceBaseline = requests.length;
    return { ...info, externalRequests: 0, apiRequests: 0, initialStaticRequests: requests.length };
  }`);
  await run('Five frames, five grades, and new numeric controls fit the desktop editor', `async (page) => {
    const layout = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      const preview = document.querySelector('canvas').getBoundingClientRect();
      const grain = document.querySelector('#grain-input').getBoundingClientRect();
      return { sidebarHeight: sidebar.clientHeight, sidebarContent: sidebar.scrollHeight, previewHeight: preview.height, finalControlBottom: grain.bottom, viewportHeight: innerHeight, formats: document.querySelectorAll('[data-size]').length, grades: document.querySelectorAll('[data-mood]').length };
    });
    if (layout.previewHeight < 400) throw new Error('Preview is still too small');
    if (layout.finalControlBottom > layout.viewportHeight || layout.sidebarContent > layout.sidebarHeight + 1) throw new Error('Settings still overflow: ' + JSON.stringify(layout));
    if (layout.formats !== 5 || layout.grades !== 5) throw new Error('The new format or grade is missing');
    for (const id of ['text-scale-input','subline-size-input','intensity-input']) {
      if (!(await page.locator('#'+id).isVisible())) throw new Error('New control is hidden: '+id);
    }
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
  await run('Undo and redo recover a real canvas drag', `async (page) => {
    const moved = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    await page.locator('#undo-button').click(); await page.__paint();
    const undone = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    if (undone.zoom !== 1.6 || undone.x !== 0 || undone.y !== -.45) throw new Error('Undo did not recover the pre-drag crop');
    await page.locator('#redo-button').click(); await page.__paint();
    const restored = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    if (JSON.stringify(restored) !== JSON.stringify(moved)) throw new Error('Redo lost the drag');
    return { moved, undone, restored };
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
  await run('Typing is grouped into one undo step and branches clear redo', `async (page) => {
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    await page.locator('#title-input').fill('');
    await page.locator('#title-input').pressSequentially('MIDNIGHT GOLD');
    await page.locator('#title-input').blur(); await page.__paint();
    const after = await page.evaluate(() => window.__viceframe.snapshot());
    if (after.history.steps !== before.history.steps + 1) throw new Error('Typing was not coalesced');
    await page.locator('#undo-button').click();
    if (await page.locator('#title-input').inputValue() !== before.title) throw new Error('Title undo lost its starting text');
    await page.locator('#redo-button').click();
    if (await page.locator('#title-input').inputValue() !== 'MIDNIGHT GOLD') throw new Error('Title redo failed');
    await page.locator('#undo-button').click();
    await page.locator('#subtitle-input').fill('GOLDEN LIGHT. NO TURNING BACK.');
    await page.locator('#subtitle-input').blur();
    if (await page.locator('#redo-button').isEnabled()) throw new Error('An edit after undo retained an obsolete redo branch');
    return { groupedSteps: 1, restoredTitle: before.title, redoBranchCleared: true };
  }`);

  await run('Default encoding and comparison are usable before any export', `async (page) => {
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.exportType !== 'png' || state.jpegQuality !== 85 || state.compareEnabled || state.recentExports.length) throw new Error('Wrong session defaults');
    if (!(await page.locator('#jpeg-quality').isDisabled()) || await page.locator('#recent-exports').isVisible()) throw new Error('Inactive export controls are misleading');
    return { encoding:'PNG', rememberedJPEGQuality:85, retainedExports:0, comparison:false };
  }`);
  for (const mood of gradeKeys) {
    await run(`Intensity 0 / 50 / 100 changes real photo pixels in ${mood}`, `async (page) => {
      await page.locator('[data-mood="${mood}"]').click();
      const crop = await page.evaluate(() => JSON.stringify(window.__viceframe.snapshot().panels));
      const hashes = [];
      for (const amount of [0,50,100]) {
        await page.__range('intensity-input', amount);
        hashes.push(await page.__exportHash());
        if (await page.locator('#intensity-value').textContent() !== amount+'%') throw new Error('Intensity output is stale');
        if (amount === 0) {
          const original = await page.evaluate(() => document.querySelector('#cover-canvas').toDataURL());
          await page.locator('#compare-original').focus(); await page.keyboard.down('Space');
          if (original !== await page.evaluate(() => document.querySelector('#cover-canvas').toDataURL())) throw new Error('Zero intensity is still graded');
          await page.keyboard.up('Space');
        }
      }
      if (new Set(hashes).size !== 3) throw new Error('The slider only changes its label');
      if (crop !== await page.evaluate(() => JSON.stringify(window.__viceframe.snapshot().panels))) throw new Error('Intensity changed framing');
      return { grade:'${mood}', intensityHashes:hashes, zeroMatchesOriginal:true, framingPreserved:true };
    }`);
  }
  await run('A continuous intensity gesture is one undoable edit', `async (page) => {
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    await page.locator('#intensity-input').focus();
    for (const amount of [55,63,72]) {
      await page.locator('#intensity-input').evaluate((el, amount) => { el.value=amount; el.dispatchEvent(new Event('input',{bubbles:true})); }, amount);
    }
    await page.locator('#intensity-input').blur(); await page.__paint();
    const after = await page.evaluate(() => window.__viceframe.snapshot());
    if (after.intensity !== 72 || after.history.steps !== before.history.steps + 1) throw new Error('Intensity gesture was not grouped');
    await page.locator('#undo-button').click();
    if (await page.locator('#intensity-input').inputValue() !== String(before.intensity)) throw new Error('Intensity undo lost the start');
    await page.locator('#redo-button').click();
    if (await page.locator('#intensity-value').textContent() !== '72%') throw new Error('Intensity redo did not synchronize the UI');
    await page.__range('intensity-input',100);
    return { groupedSteps:1, undoneIntensity:before.intensity, redoneIntensity:72 };
  }`);
  await run('Headline sizing changes lettering while preserving the photo crops', `async (page) => {
    const before = await page.__exportHash();
    const crop = await page.evaluate(() => JSON.stringify(window.__viceframe.snapshot().panels));
    await page.__range('text-scale-input',60);
    const smaller = await page.__exportHash();
    const geometry = await page.evaluate(() => window.__viceframe.inspectLayout());
    if (before === smaller || geometry.headlineScale !== .6) throw new Error('Headline size is only cosmetic UI');
    await page.locator('#undo-button').click(); await page.__paint();
    if (await page.locator('#text-scale-value').textContent() !== '100%' || await page.__exportHash() !== before) throw new Error('Typography undo failed');
    await page.locator('#redo-button').click(); await page.__paint();
    if (await page.__exportHash() !== smaller) throw new Error('Typography redo did not recover its pixels');
    if (crop !== await page.evaluate(() => JSON.stringify(window.__viceframe.snapshot().panels))) throw new Error('Text sizing changed a crop');
    await page.__range('text-scale-input',100);
    return { fullSizeHash:before, smallerHash:smaller, minimumScale:.6, cropsPreserved:true };
  }`);
  await run('Subline size is independently rendered and undoable', `async (page) => {
    const original = await page.__exportHash();
    await page.__range('subline-size-input',24);
    const larger = await page.__exportHash();
    if (larger === original || await page.locator('#subline-size-value').textContent() !== '24 px') throw new Error('Subline sizing failed');
    await page.locator('#undo-button').click(); await page.__paint();
    if (await page.__exportHash() !== original) throw new Error('Subline undo failed');
    await page.locator('#redo-button').click(); await page.__paint();
    if (await page.__exportHash() !== larger) throw new Error('Subline redo failed');
    await page.__range('subline-size-input',10);
    if (await page.__exportHash() === larger) throw new Error('Subline minimum was not rendered');
    await page.__range('subline-size-input',15);
    return { minimumPixels:10, maximumPixels:24, independentControl:true, historyRestoresPixels:true };
  }`);
  await run('Empty and multiline captions remain exportable with sized type', `async (page) => {
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    await page.locator('#title-input').fill(${JSON.stringify('THIS CITY\nHAS NO RULES\nAND NEITHER DO I')});
    await page.__range('text-scale-input',80);
    const multiline = await page.__exportHash();
    await page.locator('#title-input').fill(''); await page.locator('#subtitle-input').fill('');
    const empty = await page.evaluate(async () => { const output=await window.__viceframe.exportPNG(); return {filename:output.filename,bytes:output.blob.size}; });
    if (!empty.filename.includes('your-cover') || !empty.bytes) throw new Error('Blank caption broke export');
    await page.locator('#title-input').fill(before.title); await page.locator('#subtitle-input').fill(before.subtitle);
    await page.__range('text-scale-input',100);
    return { multilineHash:multiline, blankCaptionFilename:empty.filename };
  }`);
  await run('G cycles all five grades and wraps to the starting grade', `async (page) => {
    await page.locator('[data-mood="sunset"]').click(); await page.locator('#cover-canvas').focus();
    const seen = [];
    for (const expected of ['neon','coast','night','vice','sunset']) {
      await page.keyboard.press('g'); await page.__paint();
      const state = await page.evaluate(() => window.__viceframe.snapshot());
      if (state.mood !== expected || await page.locator('[data-mood="'+expected+'"]').getAttribute('aria-pressed') !== 'true') throw new Error('G cycle failed');
      seen.push(state.mood);
    }
    return { cycle:seen, includesNeonVice:true };
  }`);
  await run('F cycles every real format including the new 3:1 Banner', `async (page) => {
    await page.locator('[data-size="square"]').click(); await page.locator('#cover-canvas').focus();
    const seen = [];
    for (const expected of ['portrait','wide','story','banner','square']) {
      await page.keyboard.press('f'); await page.__paint();
      const state = await page.evaluate(() => window.__viceframe.snapshot());
      if (state.size !== expected) throw new Error('F cycle failed');
      const dimensions = await page.evaluate(() => [document.querySelector('#cover-canvas').width,document.querySelector('#cover-canvas').height]);
      seen.push({size:state.size,dimensions});
    }
    if (seen[3].dimensions.join('x') !== '1920x640') throw new Error('Banner is only a renamed existing format');
    return { cycle:seen };
  }`);
  await run('H and C toggle editor-only guides and split comparison', `async (page) => {
    await page.locator('#cover-canvas').focus();
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    const hash = await page.__exportHash();
    await page.keyboard.press('h');
    if (!(await page.locator('#safe-area-overlay').isVisible())) throw new Error('H did not show guides');
    await page.keyboard.press('c');
    if (!(await page.locator('#compare-handle').isVisible())) throw new Error('C did not enable split comparison');
    if (await page.__exportHash() !== hash) throw new Error('A view shortcut changed exported pixels');
    await page.keyboard.press('h'); await page.keyboard.press('c');
    const after = await page.evaluate(() => window.__viceframe.snapshot());
    if (after.guides || after.compareEnabled || after.history.steps !== before.history.steps) throw new Error('View shortcuts polluted history');
    return { guidesToggle:true, comparisonToggle:true, exportedPixelsIdentical:true, historyPreserved:true };
  }`);
  await run('Letter shortcuts ignore typing, modifiers, key repeats, and composition', `async (page) => {
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    await page.locator('#title-input').focus(); await page.keyboard.type('gfhc');
    const typed = await page.evaluate(() => window.__viceframe.snapshot());
    for (const key of ['size','mood','guides','compareEnabled']) if (typed[key] !== before[key]) throw new Error('Typing triggered a shortcut: '+key);
    if (!typed.title.endsWith('gfhc')) throw new Error('Shortcut letters were swallowed');
    await page.locator('#cover-canvas').focus();
    await page.evaluate(() => {
      for (const options of [{repeat:true},{isComposing:true},{altKey:true},{ctrlKey:true}]) document.querySelector('#cover-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'g',bubbles:true,...options}));
    });
    if (await page.evaluate(() => window.__viceframe.snapshot().mood) !== before.mood) throw new Error('A guarded shortcut cycled the grade');
    await page.locator('#title-input').fill(before.title); await page.locator('#title-input').blur();
    return { typedLetters:'gfhc', guardedVariants:4, artworkChoicesPreserved:true };
  }`);

  await run('Square and Story keep independent crop memories', `async (page) => {
    async function crop(zoom, x, y) {
      for (const [key, value] of Object.entries({zoom,x,y})) {
        await page.locator('#'+key+'-input').evaluate((el, value) => { el.value=String(value); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }, value);
      }
    }
    await crop(1.58, .21, -.17);
    const square = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    await page.locator('[data-size="story"]').click();
    await crop(2.05, -.33, .24);
    const story = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    await page.locator('[data-size="square"]').click();
    if (JSON.stringify(await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop)) !== JSON.stringify(square)) throw new Error('Square framing changed');
    await page.locator('[data-size="story"]').click();
    if (JSON.stringify(await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop)) !== JSON.stringify(story)) throw new Error('Story framing changed');
    await page.locator('#reset-crop').click();
    await page.locator('[data-size="square"]').click();
    if (JSON.stringify(await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop)) !== JSON.stringify(square)) throw new Error('Story reset destroyed Square memory');
    return { square, story, resetIsFormatLocal: true };
  }`);
  await run('Banner has independent framing and format changes remain undoable', `async (page) => {
    const square = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    await page.locator('[data-size="banner"]').click();
    await page.__range('zoom-input',2.3); await page.__range('x-input',.4); await page.__range('y-input',-.1);
    const banner = await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop);
    await page.locator('[data-size="square"]').click();
    if (JSON.stringify(await page.evaluate(() => window.__viceframe.snapshot().panels.hero.crop)) !== JSON.stringify(square)) throw new Error('Banner crop overwrote Square');
    await page.locator('#undo-button').click(); await page.__paint();
    const undone = await page.evaluate(() => window.__viceframe.snapshot());
    if (undone.size !== 'banner' || JSON.stringify(undone.panels.hero.crop) !== JSON.stringify(banner)) throw new Error('Format undo lost Banner framing');
    await page.locator('#redo-button').click();
    if (await page.evaluate(() => window.__viceframe.snapshot().size) !== 'square') throw new Error('Format redo failed');
    return { square, banner, formatUndo:true, formatRedo:true };
  }`);
  for (const size of formatKeys) {
    await run(`Five distinct grades and fully inset label rails in ${size}`, `async (page) => {
      await page.locator('[data-size="${size}"]').click();
      const hashes = {};
      for (const mood of ${JSON.stringify(gradeKeys)}) {
        await page.locator('[data-mood="'+mood+'"]').click(); await page.__paint();
        hashes[mood] = await page.__exportHash();
        if (await page.locator('[data-mood="'+mood+'"]').getAttribute('aria-pressed') !== 'true') throw new Error('Grade is not selectable');
      }
      if (new Set(Object.values(hashes)).size !== 5) throw new Error('A grade did not change output');
      const geometry = await page.evaluate(() => window.__viceframe.inspectLayout());
      const clearances = [];
      for (const rail of geometry.labels) {
        const polygon = geometry.polygons[rail.panel];
        for (const point of rail.corners) {
          const crosses = polygon.map((a,index) => { const b=polygon[(index+1)%polygon.length]; return (b[0]-a[0])*(point[1]-a[1])-(b[1]-a[1])*(point[0]-a[0]); });
          if (!(crosses.every(value => value >= 0) || crosses.every(value => value <= 0))) throw new Error('Label corner is outside its panel');
          const distance = Math.min(...polygon.map((a,index) => {
            const b=polygon[(index+1)%polygon.length]; const vx=b[0]-a[0], vy=b[1]-a[1];
            const t=Math.max(0,Math.min(1,((point[0]-a[0])*vx+(point[1]-a[1])*vy)/(vx*vx+vy*vy)));
            return Math.hypot(point[0]-(a[0]+t*vx),point[1]-(a[1]+t*vy));
          }));
          if (distance < 15.99) throw new Error('Label is too close to a diagonal edge');
          clearances.push(distance);
        }
        if (68 + rail.textWidth + 16 > rail.width || rail.height < 46) throw new Error('Text lacks internal padding');
        for (const reserved of rail.reserved) {
          if (rail.x < reserved.x + reserved.width && rail.x + rail.width > reserved.x && rail.y < reserved.y + reserved.height && rail.y + rail.height > reserved.y) throw new Error('Panel rail overlaps the edition badge');
        }
      }
      return { format:'${size}', gradeHashes:hashes, minimumLabelClearance:Math.min(...clearances), rails:geometry.labels.map(({panel,x,y,width,height,label,number})=>({panel,x,y,width,height,label,number})) };
    }`);
  }

  // Each of the 25 pairs is an independently named check with actual PNG bytes,
  // canvas dimensions, control selection, and layout bounds observed in-browser.
  for (const [size, { width, height }] of Object.entries(SIZES)) {
    for (const mood of gradeKeys) {
      await run(`Layout / grade / export combination: ${size} + ${mood}`, `async (page) => {
        await page.locator('[data-size="${size}"]').click(); await page.locator('[data-mood="${mood}"]').click(); await page.__paint();
        const info = await page.evaluate(() => ({state:window.__viceframe.snapshot(),layout:window.__viceframe.inspectLayout(),dimensions:[document.querySelector('#cover-canvas').width,document.querySelector('#cover-canvas').height]}));
        if (info.dimensions.join('x') !== '${width}x${height}' || info.state.size !== '${size}' || info.state.mood !== '${mood}') throw new Error('Pair did not reach its render state');
        if (await page.locator('[data-size="${size}"]').getAttribute('aria-pressed') !== 'true' || await page.locator('[data-mood="${mood}"]').getAttribute('aria-pressed') !== 'true') throw new Error('Pair controls are stale');
        const area = info.layout.title;
        if (area.x < 0 || area.y < 0 || area.x + area.width > ${width} || area.y + area.height > ${height}) throw new Error('Headline is outside the export');
        if (info.layout.labels.some(rail => rail.x < 0 || rail.y < 0 || rail.x + rail.width > ${width} || rail.y + rail.height > ${height})) throw new Error('Label rail leaves the export');
        const hash = await page.__exportHash();
        if (!page.__pairHashes) page.__pairHashes = {};
        if (!page.__pairHashes['${size}']) page.__pairHashes['${size}'] = [];
        if (page.__pairHashes['${size}'].includes(hash)) throw new Error('Two grades produce the same PNG');
        page.__pairHashes['${size}'].push(hash);
        return {format:'${size}',grade:'${mood}',width:${width},height:${height},sha256:hash,readableLabels:info.layout.labels.map(rail => rail.label)};
      }`);
    }
  }
  await run('Split comparison reveals a real original render with matching dimensions', `async (page) => {
    await page.locator('[data-size="square"]').click(); await page.locator('[data-mood="vice"]').click(); await page.__paint();
    const before = await page.__exportHash();
    const steps = await page.evaluate(() => window.__viceframe.snapshot().history.steps);
    await page.locator('#compare-toggle').click();
    const info = await page.evaluate(() => ({state:window.__viceframe.snapshot(),original:document.querySelector('#original-canvas').toDataURL(),graded:document.querySelector('#cover-canvas').toDataURL(),dimensions:[document.querySelector('#original-canvas').width,document.querySelector('#original-canvas').height],clip:document.querySelector('#comparison-original').style.clipPath}));
    if (!info.state.compareEnabled || info.original === info.graded || info.dimensions.join('x') !== '1080x1080') throw new Error('Split comparison has no original photo render');
    if (!info.clip.includes('50%') || await page.locator('#compare-handle').getAttribute('aria-valuenow') !== '50') throw new Error('Initial reveal is incorrect');
    if (await page.__exportHash() !== before || info.state.history.steps !== steps) throw new Error('Comparison changed artwork or export');
    return { originalRenderDiffers:true,dimensions:info.dimensions,reveal:50,exportUnchanged:true };
  }`);
  await run('Dragging the comparison handle changes the visible split, not a crop', `async (page) => {
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    const hash = await page.__exportHash();
    const pixels = (await page.locator('#canvas-wrap').screenshot()).toString('base64');
    const box = await page.locator('#canvas-wrap').boundingBox();
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * .76, box.y + box.height * .5, {steps:12}); await page.mouse.up();
    const after = await page.evaluate(() => window.__viceframe.snapshot());
    if (Math.abs(after.comparePosition - 76) > 1) throw new Error('Pointer did not move the reveal');
    if (pixels === (await page.locator('#canvas-wrap').screenshot()).toString('base64')) throw new Error('Split changed state but not the displayed image');
    if (JSON.stringify(after.panels) !== JSON.stringify(before.panels) || after.history.steps !== before.history.steps || await page.__exportHash() !== hash) throw new Error('Comparison drag edited the cover');
    return { before:before.comparePosition,after:after.comparePosition,displayedImageChanged:true,cropsAndExportPreserved:true };
  }`);
  await run('Comparison pointer capture clamps correctly outside either canvas edge', `async (page) => {
    const box = await page.locator('#canvas-wrap').boundingBox();
    const position = await page.evaluate(() => window.__viceframe.snapshot().comparePosition);
    await page.mouse.move(box.x + box.width * position / 100, box.y + box.height * .5);
    await page.mouse.down(); await page.mouse.move(box.x - 75, box.y + box.height * .5); await page.mouse.up();
    if (await page.locator('#compare-handle').getAttribute('aria-valuenow') !== '0') throw new Error('Left edge was not clamped');
    await page.locator('#compare-handle').focus(); await page.keyboard.press('End');
    await page.mouse.move(box.x + box.width - 2, box.y + box.height * .5);
    await page.mouse.down(); await page.mouse.move(box.x + box.width + 75, box.y + box.height * .5); await page.mouse.up();
    if (await page.locator('#compare-handle').getAttribute('aria-valuenow') !== '100') throw new Error('Right edge was not clamped');
    return {minimum:0,maximum:100,pointerCapture:true};
  }`);
  await run('Comparison slider supports accessible arrows, Home, End, and Escape', `async (page) => {
    const before = await page.evaluate(() => window.__viceframe.snapshot());
    await page.locator('#compare-handle').focus();
    const positions = [];
    for (const [key,expected] of [['Home',0],['End',100],['Shift+ArrowLeft',90],['ArrowRight',91]]) {
      await page.keyboard.press(key);
      const value = Number(await page.locator('#compare-handle').getAttribute('aria-valuenow'));
      if (value !== expected) throw new Error('Slider keyboard action failed: '+key);
      positions.push(value);
    }
    if (await page.locator('#compare-handle').getAttribute('aria-valuetext') !== '91% original, 9% graded') throw new Error('Accessible slider text is stale');
    const after = await page.evaluate(() => window.__viceframe.snapshot());
    if (JSON.stringify(after.panels) !== JSON.stringify(before.panels)) throw new Error('Slider arrows moved a photo');
    await page.keyboard.press('Escape');
    if (await page.locator('#compare-toggle').getAttribute('aria-pressed') !== 'false' || !(await page.locator('#compare-toggle').evaluate(el => el === document.activeElement))) throw new Error('Escape did not return focus to Compare');
    return {positions,accessibleValueText:true,escapeRestoresFocus:true};
  }`);
  await run('Split comparison follows crop edits and preserves its reveal across formats', `async (page) => {
    await page.locator('#compare-toggle').click();
    const original = await page.evaluate(() => document.querySelector('#original-canvas').toDataURL());
    await page.__range('zoom-input',1.85);
    if (original === await page.evaluate(() => document.querySelector('#original-canvas').toDataURL())) throw new Error('Original comparison has a stale crop');
    for (const [size,width,height] of ${JSON.stringify(Object.entries(SIZES).map(([key, { width, height }]) => [key, width, height]))}) {
      await page.locator('[data-size="'+size+'"]').click(); await page.__paint();
      const info = await page.evaluate(() => ({position:window.__viceframe.snapshot().comparePosition,dimensions:[document.querySelector('#original-canvas').width,document.querySelector('#original-canvas').height],clip:document.querySelector('#comparison-original').style.clipPath}));
      if (info.position !== 91 || info.dimensions.join('x') !== width+'x'+height || !info.clip.includes('9%')) throw new Error('Comparison lost alignment in '+size);
    }
    await page.locator('#compare-toggle').click();
    return {formats:5,originalCropRepainted:true,revealPreserved:91};
  }`);

  await run('Story safe guides and original comparison stay out of exports', `async (page) => {
    await page.locator('[data-size="story"]').click();
    await page.locator('[data-mood="night"]').click(); await page.__paint();
    const graded = await page.__exportHash();
    const pixels = await page.evaluate(() => document.querySelector('canvas').toDataURL());
    await page.locator('#guides-toggle').click();
    if (!(await page.locator('#safe-area-overlay').isVisible())) throw new Error('Guides are invisible');
    const area = await page.evaluate(() => window.__viceframe.inspectLayout().safeArea);
    if (area.y !== 240 || area.height !== 1440) throw new Error('Wrong Story safe area');
    if (await page.__exportHash() !== graded) throw new Error('Guides leaked into PNG');
    await page.locator('#compare-original').focus(); await page.keyboard.down('Space');
    if (!(await page.evaluate(() => window.__viceframe.snapshot().comparing))) throw new Error('Hold comparison failed');
    if (await page.evaluate(() => document.querySelector('canvas').toDataURL()) === pixels) throw new Error('Ungraded comparison did not paint');
    if (await page.__exportHash() !== graded) throw new Error('Held comparison leaked into PNG');
    await page.keyboard.up('Space');
    if (await page.evaluate(() => document.querySelector('canvas').toDataURL()) !== pixels) throw new Error('Release did not restore grading');
    await page.locator('#guides-toggle').click();
    return { safeArea:area, guidesExportIdentical:true, heldOriginalExportIdentical:true, comparisonRestored:true };
  }`);
  for (const [size, { width, height }] of Object.entries(SIZES)) {
    await run(`Download valid ${size} PNG at ${width} × ${height}`, `async (page) => {
      await page.locator('[data-size="${size}"]').click();
      await page.waitForFunction(() => document.querySelector('canvas').width === ${width} && document.querySelector('canvas').height === ${height});
      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export-button').click();
      const download = await downloadPromise;
      await download.saveAs(${JSON.stringify(join(exportsDir, `${size}.png`))});
      if (await download.failure()) throw new Error('Download failed');
      const details = await page.evaluate(() => window.__lastExport);
      if (details.width !== ${width} || details.height !== ${height} || details.type !== 'image/png' || details.grade !== 'night') throw new Error('Export mismatch');
      return details;
    }`);
  }

  await run('Ctrl+S exports the current cover while a text field has focus', `async (page) => {
    await page.locator('[data-size="square"]').click(); await page.locator('[data-encoding="png"]').click();
    await page.locator('#title-input').focus();
    const expected = await page.evaluate(() => window.__viceframe.snapshot());
    const pending = page.waitForEvent('download'); await page.keyboard.press('Control+s');
    const download = await pending; await download.saveAs(${JSON.stringify(join(exportsDir, 'shortcut-control.png'))});
    if (await download.failure()) throw new Error('Ctrl+S download failed');
    const info = await page.evaluate(() => window.__lastExport);
    if (info.type !== 'image/png' || info.title !== expected.title || info.format !== 'square') throw new Error('Ctrl+S exported the wrong cover');
    return {shortcut:'Control+S',textFieldFocused:true,export:info};
  }`);
  await run('Cmd+S honors the selected JPEG encoding and quality', `async (page) => {
    await page.locator('[data-encoding="jpeg"]').click(); await page.locator('#jpeg-quality').selectOption('85');
    const pending = page.waitForEvent('download'); await page.keyboard.press('Meta+s');
    const download = await pending; await download.saveAs(${JSON.stringify(join(exportsDir, 'shortcut-meta.jpg'))});
    if (await download.failure()) throw new Error('Cmd+S download failed');
    const info = await page.evaluate(() => window.__lastExport);
    if (info.type !== 'image/jpeg' || info.quality !== 85 || !download.suggestedFilename().endsWith('.jpg')) throw new Error('Cmd+S ignored JPEG preferences');
    return {shortcut:'Meta+S',export:info};
  }`);
  await run('Encoding and JPEG quality can be undone without changing cover pixels', `async (page) => {
    const hash = await page.__exportHash();
    await page.locator('#jpeg-quality').selectOption('70');
    await page.locator('#undo-button').click();
    if (await page.locator('#jpeg-quality').inputValue() !== '85') throw new Error('Quality undo failed');
    await page.locator('#redo-button').click();
    if (await page.locator('#jpeg-quality').inputValue() !== '70') throw new Error('Quality redo failed');
    await page.locator('[data-encoding="png"]').click();
    if (!(await page.locator('#jpeg-quality').isDisabled()) || await page.locator('#export-button span').textContent() !== 'Export PNG') throw new Error('PNG controls did not synchronize');
    await page.locator('#undo-button').click();
    if (await page.locator('[data-encoding="jpeg"]').getAttribute('aria-pressed') !== 'true' || await page.locator('#jpeg-quality').isDisabled()) throw new Error('Encoding undo failed');
    if (await page.__exportHash() !== hash) throw new Error('Encoding preference changed rendered pixels');
    return {qualityUndo:true,qualityRedo:true,encodingUndo:true,canonicalPNGUnchanged:true};
  }`);
  for (const [size, { width, height }] of Object.entries(SIZES)) {
    for (const quality of JPEG_QUALITIES) {
      await run(`Download and decode ${size} JPEG at ${quality}% quality`, `async (page) => {
        await page.locator('[data-size="${size}"]').click(); await page.locator('[data-encoding="jpeg"]').click();
        await page.locator('#jpeg-quality').selectOption('${quality}'); await page.__paint();
        const pending = page.waitForEvent('download'); await page.locator('#export-button').click();
        const download = await pending; await download.saveAs(${JSON.stringify(join(exportsDir, `${size}-q${quality}.jpg`))});
        if (await download.failure()) throw new Error('JPEG download failed');
        const info = await page.evaluate(async () => {
          const details = window.__lastExport;
          const output = await window.__viceframe.exportImage();
          const bytes = new Uint8Array(await output.blob.arrayBuffer());
          if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217) throw new Error('Invalid JPEG signature');
          const image = await createImageBitmap(output.blob);
          const dimensions = [image.width,image.height]; image.close();
          return {details,dimensions,bytes:bytes.length};
        });
        if (info.details.type !== 'image/jpeg' || info.details.quality !== ${quality} || info.dimensions.join('x') !== '${width}x${height}' || info.details.bytes !== info.bytes) throw new Error('Encoded JPEG differs from its advertised settings');
        if (!page.__jpegSizes) page.__jpegSizes = {};
        if (!page.__jpegSizes['${size}']) page.__jpegSizes['${size}'] = {};
        page.__jpegSizes['${size}'][${quality}] = info.bytes;
        if (${quality} === 95) {
          const sizes = page.__jpegSizes['${size}'];
          if (!(sizes[70] < sizes[85] && sizes[85] < sizes[95])) throw new Error('Quality selector did not affect encoding size');
        }
        return {format:'${size}',quality:${quality},width:${width},height:${height},bytes:info.bytes,decoded:true};
      }`);
    }
  }
  await run('PNG ignores JPEG quality and preserves it for the next JPEG', `async (page) => {
    await page.locator('[data-encoding="png"]').click();
    const first = await page.__exportHash();
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.jpegQuality !== 95 || !(await page.locator('#jpeg-quality').isDisabled())) throw new Error('PNG discarded remembered JPEG quality');
    await page.locator('[data-encoding="jpeg"]').click(); await page.locator('#jpeg-quality').selectOption('70');
    await page.locator('[data-encoding="png"]').click();
    if (await page.__exportHash() !== first) throw new Error('JPEG quality leaked into lossless PNG');
    const details = await page.evaluate(async () => {const output=await window.__viceframe.exportPNG();return {quality:output.quality,type:output.blob.type};});
    if (details.quality !== null || details.type !== 'image/png') throw new Error('PNG has JPEG metadata');
    return {pngBytesIdenticalAcrossQuality:true,rememberedJPEGQuality:70,pngQuality:null};
  }`);
  await run('Asynchronous export freezes caption, grade strength, crop, and quality', `async (page) => {
    await page.locator('[data-encoding="jpeg"]').click(); await page.locator('#jpeg-quality').selectOption('85');
    const info = await page.evaluate(async () => {
      const before = window.__viceframe.snapshot();
      const reference = await window.__viceframe.exportImage();
      const pending = window.__viceframe.exportImage();
      for (const [id,value] of [['title-input','CHANGED AFTER EXPORT'],['intensity-input','33'],['zoom-input','2.7']]) {
        const input=document.querySelector('#'+id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
      }
      const selector=document.querySelector('#jpeg-quality');selector.value='70';selector.dispatchEvent(new Event('change',{bubbles:true}));
      const output = await pending;
      const expectedBytes = new Uint8Array(await reference.blob.arrayBuffer());
      const capturedBytes = new Uint8Array(await output.blob.arrayBuffer());
      if (expectedBytes.length !== capturedBytes.length || expectedBytes.some((value,index) => value !== capturedBytes[index])) throw new Error('Export pixels changed after the snapshot');
      if (output.title !== before.title || output.intensity !== before.intensity || output.quality !== before.jpegQuality) throw new Error('Export read mutable settings after encoding started');
      const current = window.__viceframe.snapshot();
      if (current.title !== 'CHANGED AFTER EXPORT' || current.intensity !== 33 || current.panels.hero.crop.zoom !== 2.7) throw new Error('Fixture did not edit during the pending export');
      return {before,exported:{title:output.title,intensity:output.intensity,quality:output.quality,bytes:output.blob.size},after:current};
    });
    await page.locator('#title-input').fill(info.before.title);
    await page.__range('intensity-input',info.before.intensity); await page.__range('zoom-input',info.before.panels.hero.crop.zoom);
    await page.locator('#jpeg-quality').selectOption(String(info.before.jpegQuality));
    return {capturedSettings:info.exported,editsDuringEncode:true,capturedPixelsIdentical:true};
  }`);
  await run('Clear recent exports releases the session strip without altering artwork', `async (page) => {
    const hash = await page.__exportHash();
    await page.locator('#recent-exports summary').click(); await page.locator('#clear-recent').click();
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.recentExports.length || await page.locator('#recent-exports').isVisible() || await page.locator('.recent-download').count()) throw new Error('Recent strip did not clear');
    if (await page.__exportHash() !== hash) throw new Error('Clearing exports changed the cover');
    return {retainedExports:0,artworkUnchanged:true};
  }`);
  await run('Recent exports retain six distinct snapshots and decoded thumbnails', `async (page) => {
    const formats = ${JSON.stringify(formatKeys)};
    for (let index=0; index<7; index++) {
      await page.locator('#title-input').fill('SESSION TAKE '+index);
      await page.locator('[data-size="'+formats[index%formats.length]+'"]').click();
      await page.locator('[data-encoding="'+(index%2 ? 'jpeg' : 'png')+'"]').click();
      const pending=page.waitForEvent('download'); await page.locator('#export-button').click();
      const download=await pending;
      const extension=index%2 ? 'jpg' : 'png';
      await download.saveAs(${JSON.stringify(exportsDir)}+'/recent-'+index+'.'+extension);
      if (await download.failure()) throw new Error('Recent fixture export failed');
    }
    await page.locator('#recent-exports summary').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.recent-download img')].every(image => image.complete && image.naturalWidth > 0));
    const info=await page.evaluate(() => ({state:window.__viceframe.snapshot(),thumbnails:[...document.querySelectorAll('.recent-download img')].map(image => ({width:image.naturalWidth,height:image.naturalHeight,local:image.src.startsWith('data:image/jpeg;')}))}));
    const retained=info.state.recentExports;
    if (retained.length !== 6 || new Set(retained.map(output => output.id)).size !== 6 || retained.some(output => output.title === 'SESSION TAKE 0')) throw new Error('Recent export limit or snapshot identity failed');
    if (retained.map(output => output.title).join('|') !== [6,5,4,3,2,1].map(index => 'SESSION TAKE '+index).join('|')) throw new Error('Recent order is not newest first');
    if (info.thumbnails.some(image => !image.local || !image.width || !image.height || Math.max(image.width,image.height)>160)) throw new Error('Recent thumbnails are broken or full-size');
    if (await page.locator('.recent-download').count() !== 6) throw new Error('Re-download buttons are missing');
    return {retainedSnapshots:retained,thumbnails:info.thumbnails,oldestEvicted:true};
  }`);
  await run('A recent re-download uses its captured filename and settings after edits', `async (page) => {
    const before=await page.evaluate(() => window.__viceframe.snapshot());
    const original=before.recentExports[0];
    await page.locator('#title-input').fill('EDITED SINCE EXPORT'); await page.locator('[data-size="wide"]').click();
    await page.locator('[data-mood="coast"]').click(); await page.locator('[data-encoding="jpeg"]').click();
    const pending=page.waitForEvent('download'); await page.locator('.recent-download').first().click();
    const download=await pending; await download.saveAs(${JSON.stringify(join(exportsDir, 'recent-redownload.png'))});
    if (await download.failure() || download.suggestedFilename() !== original.filename) throw new Error('Recent filename or download changed');
    const info=await page.evaluate(() => ({state:window.__viceframe.snapshot(),export:window.__lastExport}));
    for (const key of ['filename','title','type','format','grade','intensity','quality','bytes']) if (info.export[key] !== original[key]) throw new Error('Recent export read the current '+key);
    if (info.state.title !== 'EDITED SINCE EXPORT' || info.state.size !== 'wide' || info.state.recentExports.length !== 6 || info.state.recentExports[0].id !== original.id) throw new Error('Re-download changed artwork or created another recent entry');
    return {capturedExport:info.export,currentCaption:info.state.title,newRecentEntries:0};
  }`);
  const retainedOriginal = readFileSync(join(exportsDir, 'recent-6.png'));
  const downloadedAgain = readFileSync(join(exportsDir, 'recent-redownload.png'));
  if (!retainedOriginal.equals(downloadedAgain)) throw new Error('Saved recent re-download is not byte-identical.');
  report.push({ name:'Saved recent re-download is byte-identical to its original browser download', bytes:retainedOriginal.length, sha256:sha256(retainedOriginal) });
  console.log('PASS Saved recent re-download is byte-identical to its original browser download');
  await run('Recent exports can be cleared after re-download', `async (page) => {
    await page.locator('#clear-recent').click();
    if (await page.evaluate(() => window.__viceframe.snapshot().recentExports.length) !== 0) throw new Error('Recent blobs remain reachable after clear');
    return {remainingExports:0};
  }`);

  await run('Zero requests during upload, editing and all exports', `async (page) => {
    const additional = page.__viceRequests.slice(page.__viceBaseline);
    if (additional.some(r => /^https?:/.test(r.url))) throw new Error('An interaction made an HTTP request');
    return { interactionHttpRequests: 0, externalRequests: 0, apiRequests: 0 };
  }`);
  await client.call('browser_network_requests', { static: true, filename: join(client.output, 'network-first.txt') });

  await client.call('browser_click', { target: '[data-sample="boulevard"]', element: 'Start a fresh local upload library' });
  await client.call('browser_click', { target: '#upload-button', element: 'Upload the actual PNG download' });
  await client.call('browser_file_upload', { paths: [join(exportsDir, 'square.png')] });
  await run('A downloaded PNG can be uploaded and edited as a local photo', `async (page) => {
    await page.waitForFunction(() => window.__viceframe.snapshot().photos[0]?.name === 'square.png');
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.photos.length !== 1 || state.photos[0].sample) throw new Error('PNG did not replace the sample');
    await page.locator('[data-panel="hero"]').click();
    if (!(await page.locator('#source-photo-info').textContent()).startsWith('1080 × 1080 source')) throw new Error('PNG source dimensions were not decoded');
    await page.__range('zoom-input',1.3); await page.__exportHash();
    return {localPhoto:'square.png',sourceDimensions:[1080,1080],cropEditable:true,reexportable:true};
  }`);
  await run('Create a real WEBP upload fixture through a browser download', `async (page) => {
    await page.locator('[data-size="square"]').click(); await page.__paint();
    const pending=page.waitForEvent('download');
    await page.evaluate(async () => {
      const blob=await new Promise(resolve => document.querySelector('#cover-canvas').toBlob(resolve,'image/webp',.8));
      if (!blob || blob.type !== 'image/webp') throw new Error('Browser could not encode WEBP fixture');
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='upload.webp';document.body.append(link);link.click();link.remove();setTimeout(() => URL.revokeObjectURL(url),10000);
    });
    const download=await pending;await download.saveAs(${JSON.stringify(join(exportsDir, 'upload.webp'))});
    if (await download.failure()) throw new Error('WEBP fixture download failed');
    return {fixture:'upload.webp',encodedByBrowser:true};
  }`);
  await client.call('browser_click', { target: '[data-sample="pier"]', element: 'Reset the library before a WEBP upload' });
  await client.call('browser_click', { target: '#upload-button', element: 'Upload the downloaded WEBP' });
  await client.call('browser_file_upload', { paths: [join(exportsDir, 'upload.webp')] });
  await run('WEBP uploads decode, stay local, and export to PNG', `async (page) => {
    await page.waitForFunction(() => window.__viceframe.snapshot().photos[0]?.name === 'upload.webp');
    const state = await page.evaluate(() => window.__viceframe.snapshot());
    if (state.photos.length !== 1 || state.photos[0].sample || !(await page.locator('.photo-tile img').getAttribute('src')).startsWith('data:image/webp;')) throw new Error('WEBP upload was not local');
    if (!(await page.locator('#source-photo-info').textContent()).startsWith('1080 × 1080 source')) throw new Error('WEBP dimensions are wrong');
    const hash=await page.__exportHash();
    return {source:'upload.webp',decodedDimensions:[1080,1080],pngSHA256:hash};
  }`);

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

  await run('Photo removal can be undone without losing decoded images', `async (page) => {
    await page.locator('#undo-button').click();
    const restored = await page.evaluate(() => window.__viceframe.snapshot());
    if (restored.photos.length !== 4) throw new Error('Undo did not recover all four photos');
    await page.__exportHash();
    await page.locator('#redo-button').click();
    if (await page.locator('.photo-tile').count() !== 3) throw new Error('Redo did not remove the photo again');
    return { restoredPhotos:4, recoveredImagesExportable:true, redoPhotos:3 };
  }`);
  await client.call('browser_click', { target: '[data-sample="pier"]', element: 'Reset library to the permitted pier sample' });
  for (const [added, total] of [[2, 2], [1, 3], [1, 4]]) {
    await client.call('browser_click', { target: '#upload-button', element: `Upload local photos to reach ${total}` });
    await client.call('browser_file_upload', { paths: ['boulevard.jpg', 'pier.jpg'].slice(0, added).map(name => join(root, 'app/samples', name)) });
    await run(`${total} local photos remain assignable`, `async (page) => {
      await page.waitForFunction(() => window.__viceframe.snapshot().photos.length === ${total});
      const state=await page.evaluate(() => window.__viceframe.snapshot());
      if (state.photos.some(photo=>photo.sample) || Object.values(state.panels).some(panel=>!state.photos.some(photo=>photo.id===panel.photoId))) throw new Error('Invalid local photo library');
      return { localPhotos:${total}, panelAssignmentsValid:true };
    }`);
  }
  await client.call('browser_click', { target: '#upload-button', element: 'Check the four-photo capacity' });
  await client.call('browser_file_upload', { paths: [join(root, 'app/samples/pier.jpg')] });
  await run('A fifth upload is handled without damaging the cover', `async (page) => {
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Four photos are loaded'));
    if (await page.locator('.photo-tile').count() !== 4) throw new Error('Photo cap failed');
    return { capacity:4, extraPhotoRejected:true };
  }`);
  await run('Shortcut edits respect the 50-step history bound and retain decoded photos', `async (page) => {
    await page.locator('#cover-canvas').focus();
    for (let index=0; index<62; index++) await page.keyboard.press('g');
    const bounded=await page.evaluate(() => window.__viceframe.snapshot());
    if (bounded.history.retained !== 50 || bounded.history.steps !== 50 || bounded.history.limit !== 50) throw new Error('History exceeds its tab-local limit');
    for (let index=0; index<50; index++) await page.locator('#undo-button').click();
    const restored=await page.evaluate(() => window.__viceframe.snapshot());
    if (restored.history.undo || restored.history.steps !== 0 || restored.photos.length !== 4) throw new Error('Bounded history lost its base or decoded photos');
    await page.__exportHash();
    await page.locator('#cover-canvas').focus(); await page.keyboard.press('Control+Shift+z');
    if (await page.evaluate(() => window.__viceframe.snapshot().history.steps) !== 1) throw new Error('Shortcut redo failed after bounded undo');
    return {retainedSteps:50,allRetainedStepsUndoable:true,decodedPhotos:4,shortcutRedo:true};
  }`);

  for (const size of formatKeys) {
    const query = new URLSearchParams({ shot: 'cover', size, mood: 'vice', grain: '14', intensity: '73', textScale: '88', sublineSize: '20', photo: 'boulevard', caption: 'VICE AFTER DARK' });
    await client.call('browser_navigate', { url: `${fileEntry}?${query}` });
    await run(`Deterministic exported-PNG shot mode in ${size}`, `async (page) => {
      await page.waitForFunction(() => window.__shotReady === true);
      const info = await page.evaluate(() => ({ export:window.__lastExport, source:document.querySelector('#export-image').src.slice(0,25), natural:[document.querySelector('#export-image').naturalWidth,document.querySelector('#export-image').naturalHeight], state:window.__viceframe.snapshot() }));
      if (!info.source.startsWith('data:image/png;') || info.natural.join('x') !== [info.export.width,info.export.height].join('x')) throw new Error('Shot is not the exported cover');
      if (info.state.size !== '${size}' || info.state.mood !== 'vice' || info.state.grain !== 14 || info.state.intensity !== 73 || info.state.textScale !== 88 || info.state.sublineSize !== 20) throw new Error('Shot query was not applied');
      const first = await page.__exportHash();
      await page.reload(); await page.waitForFunction(() => window.__shotReady === true);
      const second = await page.__exportHash();
      if (first !== second) throw new Error('Shot pixels are not repeatable');
      return { format:'${size}', export:info.export, natural:info.natural, sha256:second, repeatExportIdentical:true };
    }`);
  }
  await client.call('browser_navigate', { url: `${fileEntry}?shot=editor&size=story&mood=night&guides=1&grain=40&photo=pier.jpg` });
  await run('Story editor shot applies its query and fits without cropping', `async (page) => {
    await page.waitForFunction(() => window.__shotReady === true);
    const info = await page.evaluate(() => {
      const canvas=document.querySelector('canvas').getBoundingClientRect(); const stage=document.querySelector('#stage').getBoundingClientRect();
      return { state:window.__viceframe.snapshot(), canvas:{width:canvas.width,height:canvas.height,left:canvas.left,right:canvas.right,top:canvas.top,bottom:canvas.bottom}, stage:{left:stage.left,right:stage.right,top:stage.top,bottom:stage.bottom} };
    });
    if (info.state.size !== 'story' || info.state.mood !== 'night' || !info.state.guides || info.state.photos[0].id !== 'pier') throw new Error('Story editor query failed');
    if (Math.abs(info.canvas.width/info.canvas.height-9/16)>.004 || info.canvas.left<info.stage.left || info.canvas.right>info.stage.right || info.canvas.bottom>info.stage.bottom) throw new Error('Story preview does not fit');
    return info;
  }`);

  await client.call('browser_navigate', { url: `${fileEntry}?shot=editor&size=banner&mood=vice&intensity=83&textScale=92&sublineSize=20&compare=1&split=37&encoding=jpeg&quality=95&photo=pier` });
  await run('Editor shot applies all new preferences and repeats its split view', `async (page) => {
    await page.waitForFunction(() => window.__shotReady);
    const first=await page.__exportHash();
    const info=await page.evaluate(() => ({state:window.__viceframe.snapshot(),clip:document.querySelector('#comparison-original').style.clipPath,dimensions:[document.querySelector('#original-canvas').width,document.querySelector('#original-canvas').height]}));
    const state=info.state;
    if (state.size !== 'banner' || state.mood !== 'vice' || state.intensity !== 83 || state.textScale !== 92 || state.sublineSize !== 20 || !state.compareEnabled || state.comparePosition !== 37 || state.exportType !== 'jpeg' || state.jpegQuality !== 95) throw new Error('New editor query preferences were ignored');
    if (!info.clip.includes('63%') || info.dimensions.join('x') !== '1920x640' || state.recentExports.length) throw new Error('Editor shot created stale comparison or recent entries');
    await page.reload(); await page.waitForFunction(() => window.__shotReady);
    if (await page.__exportHash() !== first) throw new Error('New editor query is not repeatable');
    return {preferences:state,sha256:first,repeatable:true};
  }`);
  for (const [width,height] of [[1440,900],[900,720],[390,844]]) {
    await client.call('browser_resize', { width, height });
    await run(`Responsive editor controls and comparison fit at ${width} × ${height}`, `async (page) => {
      await page.__paint();
      const info=await page.evaluate(() => {
        const canvas=document.querySelector('#cover-canvas').getBoundingClientRect();
        const stage=document.querySelector('#stage').getBoundingClientRect();
        return {viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,canvas:{left:canvas.left,right:canvas.right,top:canvas.top,bottom:canvas.bottom,width:canvas.width,height:canvas.height},stage:{left:stage.left,right:stage.right,top:stage.top,bottom:stage.bottom}};
      });
      if (info.documentWidth > ${width}+1 || info.canvas.left < info.stage.left || info.canvas.right > info.stage.right || info.canvas.top < info.stage.top || info.canvas.bottom > info.stage.bottom) throw new Error('Responsive layout overflows: '+JSON.stringify(info));
      if (Math.abs(info.canvas.width/info.canvas.height-3)>.04) throw new Error('Banner was stretched at a breakpoint');
      await page.locator('#intensity-input').scrollIntoViewIfNeeded(); await page.__range('intensity-input',77);
      await page.locator('#text-scale-input').scrollIntoViewIfNeeded(); await page.__range('text-scale-input',86);
      const state=await page.evaluate(() => window.__viceframe.snapshot());
      if (state.intensity !== 77 || state.textScale !== 86 || !state.compareEnabled) throw new Error('Responsive controls cannot be edited');
      return {width:${width},height:${height},horizontalOverflow:false,previewFits:true,controlsReachable:true};
    }`);
  }
  await client.call('browser_resize', { width:1280,height:720 });
  await client.call('browser_navigate', { url: `${fileEntry}?shot=cover&size=story&mood=vice&intensity=67&textScale=94&sublineSize=18&encoding=jpeg&quality=95&compare=1&split=20&photo=pier` });
  await run('Cover shot always displays the clean exported PNG despite editor view preferences', `async (page) => {
    await page.waitForFunction(() => window.__shotReady);
    const info=await page.evaluate(() => ({state:window.__viceframe.snapshot(),export:window.__lastExport,source:document.querySelector('#export-image').src.slice(0,25)}));
    if (!info.source.startsWith('data:image/png;') || info.export.type !== 'image/png' || info.export.quality !== null || info.export.intensity !== 67) throw new Error('Cover shot inherited editor overlays or JPEG encoding');
    if (info.state.exportType !== 'jpeg' || !info.state.compareEnabled || info.state.recentExports.length) throw new Error('Shot preference or session isolation failed');
    const first=await page.__exportHash();await page.reload();await page.waitForFunction(() => window.__shotReady);
    if (await page.__exportHash() !== first) throw new Error('Clean cover PNG is not deterministic');
    return {export:info.export,editorPreferencesPreserved:true,cleanPNG:true,repeatable:true};
  }`);
  await client.call('browser_navigate', { url: `${fileEntry}?shot=editor&grain=-20&intensity=250&textScale=1&sublineSize=100&split=-200&compare=1&encoding=webp&quality=80` });
  await run('Out-of-range query numbers clamp and unsupported encoding choices fall back', `async (page) => {
    await page.waitForFunction(() => window.__shotReady);
    const state=await page.evaluate(() => window.__viceframe.snapshot());
    if (state.grain !== 0 || state.intensity !== 100 || state.textScale !== 60 || state.sublineSize !== 24 || state.comparePosition !== 0 || state.exportType !== 'png' || state.jpegQuality !== 85) throw new Error('Query clamping or fallback failed');
    await page.__exportHash();return {grain:state.grain,intensity:state.intensity,textScale:state.textScale,sublineSize:state.sublineSize,split:state.comparePosition,encoding:state.exportType,quality:state.jpegQuality};
  }`);
  await client.call('browser_navigate', { url: `${fileEntry}?shot=editor&grain=&intensity=&textScale=&sublineSize=&split=&encoding=jpeg&quality=` });
  await run('Blank numeric query values preserve useful defaults', `async (page) => {
    await page.waitForFunction(() => window.__shotReady);
    const state=await page.evaluate(() => window.__viceframe.snapshot());
    if (state.grain !== 18 || state.intensity !== 100 || state.textScale !== 100 || state.sublineSize !== 15 || state.comparePosition !== 50 || state.jpegQuality !== 85) throw new Error('Blank values zeroed a control');
    return {defaultsPreserved:true,encoding:state.exportType,quality:state.jpegQuality};
  }`);
  await client.call('browser_navigate', { url: `${fileEntry}?shot=editor&size=unknown&mood=unknown&grain=invalid&photo=unknown` });
  await run('Invalid shot choices have usable defaults', `async (page) => {
    await page.waitForFunction(() => window.__shotReady === true);
    const state=await page.evaluate(()=>window.__viceframe.snapshot());
    if (state.size!=='square'||state.mood!=='sunset'||state.grain!==18||state.photos[0].id!=='boulevard') throw new Error('Invalid choices broke initialization');
    return { size:state.size,mood:state.mood,grain:state.grain,sample:state.photos[0].id };
  }`);

  await client.call('browser_navigate', { url: `${fileEntry}?shot=cover&photo=boulevard&caption=VICE%20AFTER%20DARK&size=wide` });
  await run('Direct file:// opening exports a real full-size PNG with zero HTTP requests', `async (page) => {
    await page.waitForFunction(() => window.__shotReady === true);
    const details = await page.evaluate(() => ({ export: window.__lastExport, source: document.querySelector('#export-image').src.slice(0,30), image: [document.querySelector('#export-image').naturalWidth, document.querySelector('#export-image').naturalHeight] }));
    if (!details.source.startsWith('data:image/png;') || details.image.join('x') !== '1920x1080') throw new Error('File-mode PNG failed');
    const requests = page.__viceRequests.filter(r => r.url.startsWith('file:'));
    return { ...details, fileModeHttpRequests: 0, localFileResources: requests.length };
  }`);
  await run('Zero network requests or browser errors over the whole revision check', `async (page) => {
    const network=page.__viceRequests.filter(request=>/^(https?|wss?|ftp):/.test(request.url));
    if (network.length||page.__viceErrors.length) throw new Error(JSON.stringify({network,errors:page.__viceErrors}));
    return { networkRequests:0, browserErrors:0, localResourcesObserved:page.__viceRequests.filter(request=>request.url.startsWith('file:')).length };
  }`);
  await client.call('browser_console_messages', { level: 'error', filename: join(client.output, 'console-errors.txt') });
  await client.call('browser_network_requests', { static: true, filename: join(client.output, 'network-all.txt') });
  if (report.length < 45) throw new Error('The revision suite must contain at least 45 checks.');
  if (appFingerprint(join(root, 'app')) !== sourceAppSHA256) throw new Error('Application bytes changed during browser verification.');
  writeFileSync(join(root, '.verification', 'pass-2', 'browser-report.json'), JSON.stringify({ checks: report, passed: report.length, sourceAppSHA256, layouts:formatKeys.length, grades:gradeKeys.length, combinations:formatKeys.length * gradeKeys.length, networkRequests:0, browserErrors:0 }, null, 2));
  console.log(`All ${report.length} browser checks passed through Playwright MCP.`);
} finally { await client.close(); }
