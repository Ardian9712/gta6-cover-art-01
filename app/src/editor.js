import { SIZES, PANEL_NAMES, SAMPLE_PATHS, freshCrop, makeState, decodePhoto, fileAsDataURI, assignPhotos, photoForPanel, clampValue } from './state.js';
import { renderCover, canvasPNG, layoutFor, boundsFor, geometryFor, panelAt } from './renderer.js';

const state = makeState();
const byId = (name) => document.getElementById(name);
const coverCanvas = byId('cover-canvas');
const canvasWrap = byId('canvas-wrap');
const stage = byId('stage');
const titleInput = byId('title-input');
const subtitleInput = byId('subtitle-input');
const exportButton = byId('export-button');
const photoInput = byId('photo-input');
const selectionPolygon = byId('selection-polygon');
const panelSource = byId('panel-source');
const query = new URLSearchParams(location.search);
const shotMode = ['cover', 'editor'].includes(query.get('shot')) ? query.get('shot') : '';
const cachedSamples = new Map();
let framePending = false;
let toastTimer;
let busyImport = false;
let exporting = false;
let uploadedSequence = 0;
let dragState = null;
let dragDepth = 0;
window.__shotReady = false;

if (shotMode) document.body.classList.add(`shot-${shotMode}`);

function notify(message) {
  const toast = byId('toast');
  clearTimeout(toastTimer); toast.textContent = message; toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3800);
}

function fitCanvas() {
  const dimensions = SIZES[state.size];
  const styles = getComputedStyle(stage);
  const availableW = stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  const availableH = stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
  const scale = Math.min(availableW / dimensions.width, availableH / dimensions.height);
  canvasWrap.style.width = `${Math.max(1, Math.floor(dimensions.width * scale))}px`;
  canvasWrap.style.height = `${Math.max(1, Math.floor(dimensions.height * scale))}px`;
}

function renderNow() {
  renderCover(coverCanvas, state);
  const dimensions = SIZES[state.size];
  byId('dimension-label').textContent = `${dimensions.width} × ${dimensions.height}`;
  byId('selection-overlay').setAttribute('viewBox', `0 0 ${dimensions.width} ${dimensions.height}`);
  selectionPolygon.setAttribute('points', layoutFor(state.size).polygons[state.selectedPanel].map((point) => point.join(',')).join(' '));
  coverCanvas.setAttribute('aria-label', `${state.title || 'Untitled'} — ${dimensions.label} poster. ${PANEL_NAMES[state.selectedPanel]} panel selected. Drag to reposition its photo.`);
  framePending = false;
}

function scheduleRender() {
  if (!framePending) { framePending = true; requestAnimationFrame(renderNow); }
}

function syncCropControls() {
  const crop = state.panels[state.selectedPanel].crop;
  for (const key of ['zoom', 'x', 'y']) byId(`${key}-input`).value = String(crop[key]);
  byId('zoom-value').textContent = `${Math.round(crop.zoom * 100)}%`;
  byId('x-value').textContent = String(Math.round(crop.x * 100));
  byId('y-value').textContent = String(Math.round(crop.y * 100));
  byId('crop-panel-label').textContent = `${PANEL_NAMES[state.selectedPanel]} crop`;
  byId('source-panel-label').textContent = PANEL_NAMES[state.selectedPanel];
  panelSource.value = state.panels[state.selectedPanel].photoId || '';
}

function syncButtons() {
  for (const [attribute, value] of [['size', state.size], ['mood', state.mood], ['panel', state.selectedPanel]]) {
    document.querySelectorAll(`[data-${attribute}]`).forEach((button) => {
      const active = button.dataset[attribute] === value;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }
  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.classList.toggle('active', state.photos.length === 1 && state.photos[0].id === button.dataset.sample);
  });
}

function photoLibrary() {
  const library = byId('photo-library');
  library.replaceChildren(); panelSource.replaceChildren();
  byId('photo-count').textContent = `${state.photos.length} / 4`;
  for (const [index, photo] of state.photos.entries()) {
    const tile = document.createElement('div'); tile.className = 'photo-tile';
    if (photo.id === state.panels[state.selectedPanel].photoId) tile.classList.add('selected');
    const choose = document.createElement('button');
    choose.style.cssText = 'width:100%;height:100%;border:0;padding:0;background:transparent;display:block';
    choose.setAttribute('aria-label', `Use ${photo.name} in ${PANEL_NAMES[state.selectedPanel]} panel`);
    const img = document.createElement('img'); img.src = photo.src; img.alt = photo.name;
    const number = document.createElement('span'); number.className = 'photo-index'; number.textContent = `0${index + 1}`;
    choose.append(img, number);
    choose.addEventListener('click', () => selectPhoto(photo.id));
    tile.append(choose);
    if (state.photos.length > 1) {
      const remove = document.createElement('button'); remove.className = 'photo-remove';
      remove.setAttribute('aria-label', `Remove ${photo.name}`);
      remove.innerHTML = '<svg class="icon"><use href="#icon-close"/></svg>';
      remove.addEventListener('click', () => removePhoto(photo.id)); tile.append(remove);
    }
    library.append(tile);
    const option = document.createElement('option'); option.value = photo.id; option.textContent = photo.name; panelSource.append(option);
  }
  for (let i = state.photos.length; i < 4; i++) {
    const slot = document.createElement('button'); slot.className = 'photo-slot'; slot.setAttribute('aria-label', `Add photo ${i + 1}`);
    slot.innerHTML = '<svg class="icon"><use href="#icon-plus"/></svg>'; slot.addEventListener('click', () => photoInput.click()); library.append(slot);
  }
  syncCropControls(); syncButtons();
}

function selectPhoto(id) {
  state.panels[state.selectedPanel].photoId = id;
  state.panels[state.selectedPanel].crop = freshCrop(state.selectedPanel);
  photoLibrary(); scheduleRender();
}

function removePhoto(id) {
  state.photos = state.photos.filter((photo) => photo.id !== id);
  for (const panel of Object.values(state.panels)) {
    if (panel.photoId === id) panel.photoId = state.photos[0].id;
  }
  photoLibrary(); scheduleRender();
}

function selectPanel(panel) {
  state.selectedPanel = panel;
  syncCropControls(); syncButtons(); photoLibrary();
  selectionPolygon.setAttribute('points', layoutFor(state.size).polygons[panel].map((point) => point.join(',')).join(' '));
}

async function samplePhoto(name) {
  const src = globalThis.__VICEFRAME_SAMPLE_DATA__?.[name] || SAMPLE_PATHS[name];
  if (!cachedSamples.has(name)) cachedSamples.set(name, decodePhoto(src, name === 'pier' ? 'The pier' : 'Boulevard', name, true));
  return cachedSamples.get(name);
}

async function useSample(name, announce = true) {
  try {
    const photo = await samplePhoto(name);
    assignPhotos(state, [photo]); photoLibrary(); renderNow();
    if (announce) notify(`${photo.name} is in the frame. Make it yours.`);
  } catch (error) { notify(error.message); throw error; }
}

async function importPhotos(fileList) {
  if (busyImport) { notify('Finishing your last photos. One moment…'); return; }
  const files = Array.from(fileList);
  if (!files.length) return;
  const current = state.photos.filter((photo) => !photo.sample);
  const capacity = 4 - current.length;
  if (!capacity) { notify('Four photos are loaded. Remove one to add another.'); photoInput.value = ''; return; }
  busyImport = true; byId('upload-button').disabled = true;
  const loaded = [];
  const errors = [];
  for (const file of files.slice(0, capacity)) {
    try {
      if (file.type && !file.type.startsWith('image/')) throw new Error(`${file.name} is not a photo.`);
      if (file.size > 32 * 1024 * 1024) throw new Error(`${file.name} is over 32 MB. Try a smaller photo.`);
      const src = await fileAsDataURI(file);
      loaded.push(await decodePhoto(src, file.name || 'Your photo', `upload-${++uploadedSequence}`));
    } catch (error) { errors.push(error.message); }
  }
  if (loaded.length) {
    assignPhotos(state, [...current, ...loaded]);
    photoLibrary(); renderNow();
  }
  busyImport = false; byId('upload-button').disabled = false; photoInput.value = '';
  if (errors.length) notify(errors[0]);
  else if (files.length > capacity) notify(`Loaded ${loaded.length} photos. The library holds four at a time.`);
  else if (loaded.length) notify(`${loaded.length === 1 ? 'Photo' : `${loaded.length} photos`} loaded. You’re the main event.`);
}

function canvasPoint(event) {
  const rect = coverCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * coverCanvas.width / rect.width, y: (event.clientY - rect.top) * coverCanvas.height / rect.height };
}

function cropChange(key, value) {
  state.panels[state.selectedPanel].crop[key] = clampValue(Number(value), key === 'zoom' ? 1 : -1, key === 'zoom' ? 3.5 : 1);
  syncCropControls(); scheduleRender();
}

function exportName() {
  const title = state.title.normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'your-cover';
  return `viceframe-${title}-${state.size}.png`;
}

async function createExport() {
  const canvas = document.createElement('canvas');
  renderCover(canvas, state);
  const blob = await canvasPNG(canvas);
  return { blob, width: canvas.width, height: canvas.height, filename: exportName() };
}

async function exportPNG() {
  if (exporting || !state.photos.length) return;
  exporting = true; exportButton.disabled = true;
  exportButton.querySelector('span').textContent = 'Rendering…';
  try {
    const output = await createExport();
    const url = URL.createObjectURL(output.blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = output.filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    window.__lastExport = { width: output.width, height: output.height, bytes: output.blob.size, filename: output.filename, type: output.blob.type };
    notify(`Your ${output.width} × ${output.height} PNG is ready. Go make a scene.`);
  } catch (error) { notify(`Export failed: ${error.message}`); }
  exporting = false; exportButton.disabled = false;
  exportButton.querySelector('span').textContent = 'Export PNG';
}

titleInput.addEventListener('input', () => {
  state.title = titleInput.value; byId('title-count').textContent = `${state.title.length} / 72`; scheduleRender();
});
subtitleInput.addEventListener('input', () => { state.subtitle = subtitleInput.value; scheduleRender(); });
byId('grain-input').addEventListener('input', (event) => { state.grain = Number(event.target.value); byId('grain-value').textContent = `${state.grain}%`; scheduleRender(); });
byId('upload-button').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => importPhotos(photoInput.files));
panelSource.addEventListener('change', () => selectPhoto(panelSource.value));
exportButton.addEventListener('click', exportPNG);
for (const key of ['zoom', 'x', 'y']) byId(`${key}-input`).addEventListener('input', (event) => cropChange(key, event.target.value));
byId('reset-crop').addEventListener('click', () => { state.panels[state.selectedPanel].crop = freshCrop(state.selectedPanel); syncCropControls(); scheduleRender(); });
byId('preview-toggle').addEventListener('click', () => {
  state.preview = !state.preview; document.body.classList.toggle('preview-active', state.preview);
  byId('preview-toggle').setAttribute('aria-pressed', String(state.preview));
  byId('preview-toggle').querySelector('span').textContent = state.preview ? 'Edit crop' : 'Preview';
});
document.querySelectorAll('[data-size]').forEach((button) => button.addEventListener('click', () => { state.size = button.dataset.size; syncButtons(); renderNow(); fitCanvas(); }));
document.querySelectorAll('[data-mood]').forEach((button) => button.addEventListener('click', () => { state.mood = button.dataset.mood; syncButtons(); scheduleRender(); }));
document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => selectPanel(button.dataset.panel)));
document.querySelectorAll('[data-sample]').forEach((button) => button.addEventListener('click', () => { useSample(button.dataset.sample).catch(() => {}); }));

coverCanvas.addEventListener('pointerdown', (event) => {
  if (state.preview || !state.photos.length || event.button !== 0) return;
  const point = canvasPoint(event);
  const hit = panelAt(state.size, point.x, point.y);
  // An explicitly selected atmosphere stays editable anywhere, since its visible
  // strips are thin. Otherwise direct clicks select the visible photo panel.
  if (state.selectedPanel !== 'atmosphere') selectPanel(hit);
  const panel = state.selectedPanel;
  const photo = photoForPanel(state, panel);
  const geometry = geometryFor(photo.image, boundsFor(layoutFor(state.size).polygons[panel]), state.panels[panel].crop);
  dragState = { panel, start: point, crop: { ...state.panels[panel].crop }, geometry, pointerId: event.pointerId };
  coverCanvas.setPointerCapture(event.pointerId); coverCanvas.focus({ preventScroll: true }); canvasWrap.classList.add('dragging');
});
coverCanvas.addEventListener('pointermove', (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const point = canvasPoint(event);
  const { geometry, crop, start, panel } = dragState;
  const next = state.panels[panel].crop;
  if (geometry.overflowX > .01) next.x = clampValue(crop.x - (point.x - start.x) * 2 / geometry.scale / geometry.overflowX, -1, 1);
  if (geometry.overflowY > .01) next.y = clampValue(crop.y - (point.y - start.y) * 2 / geometry.scale / geometry.overflowY, -1, 1);
  syncCropControls(); scheduleRender();
});
function endDrag(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  if (coverCanvas.hasPointerCapture(event.pointerId)) coverCanvas.releasePointerCapture(event.pointerId);
  dragState = null; canvasWrap.classList.remove('dragging');
}
coverCanvas.addEventListener('pointerup', endDrag); coverCanvas.addEventListener('pointercancel', endDrag);
coverCanvas.addEventListener('lostpointercapture', () => { dragState = null; canvasWrap.classList.remove('dragging'); });
coverCanvas.addEventListener('wheel', (event) => {
  if (state.preview) return;
  event.preventDefault();
  cropChange('zoom', state.panels[state.selectedPanel].crop.zoom + (event.deltaY < 0 ? .06 : -.06));
}, { passive: false });
coverCanvas.addEventListener('keydown', (event) => {
  if (state.preview) return;
  const crop = state.panels[state.selectedPanel].crop;
  const arrows = { ArrowLeft: ['x', .04], ArrowRight: ['x', -.04], ArrowUp: ['y', .04], ArrowDown: ['y', -.04] };
  if (arrows[event.key]) { event.preventDefault(); const [key, delta] = arrows[event.key]; cropChange(key, crop[key] + delta); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); cropChange('zoom', crop.zoom + .05); }
  else if (event.key === '-' || event.key === '_') { event.preventDefault(); cropChange('zoom', crop.zoom - .05); }
});

window.addEventListener('dragenter', (event) => {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault(); dragDepth++; byId('drop-overlay').hidden = false;
});
window.addEventListener('dragover', (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }
});
window.addEventListener('dragleave', (event) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) byId('drop-overlay').hidden = true; });
window.addEventListener('drop', (event) => {
  event.preventDefault(); dragDepth = 0; byId('drop-overlay').hidden = true;
  if (event.dataTransfer?.files.length) importPhotos(event.dataTransfer.files);
});
window.addEventListener('blur', () => { dragDepth = 0; byId('drop-overlay').hidden = true; });
new ResizeObserver(fitCanvas).observe(stage);

// Read-only diagnostics make the deterministic views and export verification
// observable without adding network hooks or a second rendering path.
window.__viceframe = {
  snapshot: () => ({
    size: state.size, title: state.title, subtitle: state.subtitle, mood: state.mood, grain: state.grain,
    selectedPanel: state.selectedPanel,
    photos: state.photos.map(({ id, name, sample }) => ({ id, name, sample })),
    panels: JSON.parse(JSON.stringify(state.panels)),
  }),
  exportPNG: createExport,
};

async function initialize() {
  const sampleName = (query.get('photo') || 'boulevard').replace(/\.jpg$/i, '');
  if (query.has('caption')) state.title = query.get('caption').slice(0, 72);
  if (query.has('subtitle')) state.subtitle = query.get('subtitle').slice(0, 100);
  if (Object.hasOwn(SIZES, query.get('size'))) state.size = query.get('size');
  titleInput.value = state.title; subtitleInput.value = state.subtitle; byId('title-count').textContent = `${state.title.length} / 72`;
  await useSample(Object.hasOwn(SAMPLE_PATHS, sampleName) ? sampleName : 'boulevard', false);
  fitCanvas(); canvasWrap.classList.add('ready'); byId('loading-state').hidden = true; exportButton.disabled = false;
  if (shotMode === 'cover') {
    const output = await createExport();
    const dataURI = await fileAsDataURI(output.blob);
    const img = byId('export-image'); img.src = dataURI; await img.decode();
    byId('export-preview').hidden = false;
    window.__lastExport = { width: output.width, height: output.height, bytes: output.blob.size, filename: output.filename, type: output.blob.type };
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__shotReady = true;
}
initialize().catch((error) => { byId('loading-state').textContent = error.message; notify(error.message); console.error(error); });
