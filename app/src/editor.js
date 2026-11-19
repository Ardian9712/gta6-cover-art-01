import { SIZES, GRADES, EXPORT_ENCODINGS, JPEG_QUALITIES, RECENT_EXPORT_LIMIT, NUMBER_CONTROLS, PANEL_NAMES, SAMPLE_PATHS, makeState, decodePhoto, fileAsDataURI, assignPhotos, photoForPanel, clampValue, cycleChoice, changeNumber, changeFormat, resetPanelFraming, guideArea, readViewQuery, exportDetails } from './state.js';
import { createHistory, captureEdit } from './history.js';
import { renderCover, canvasImage, exportThumbnail, layoutFor, boundsFor, geometryFor, panelAt, panelLabelGeometry } from './renderer.js';

const state = makeState();
const history = createHistory(state);
const byId = (name) => document.getElementById(name);
const coverCanvas = byId('cover-canvas');
const originalCanvas = byId('original-canvas');
const compareHandle = byId('compare-handle');
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
const numberInputs = Object.freeze({ grain: 'grain', intensity: 'intensity', textScale: 'text-scale', sublineSize: 'subline-size' });
const recentExports = [];
let framePending = false;
let toastTimer;
let busyImport = false;
let exporting = false;
let uploadedSequence = 0;
let dragState = null;
let dragDepth = 0;
let comparing = false;
let comparisonPointer = null;
let exportSequence = 0;
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
  renderCover(coverCanvas, state, { ungraded: comparing });
  if (state.compareEnabled && !comparing) renderCover(originalCanvas, state, { ungraded: true });
  const dimensions = SIZES[state.size];
  byId('dimension-label').textContent = `${dimensions.width} × ${dimensions.height}`;
  byId('selection-overlay').setAttribute('viewBox', `0 0 ${dimensions.width} ${dimensions.height}`);
  selectionPolygon.setAttribute('points', layoutFor(state.size).polygons[state.selectedPanel].map((point) => point.join(',')).join(' '));
  coverCanvas.setAttribute('aria-label', `${state.title || 'Untitled'} — ${dimensions.label} poster. ${PANEL_NAMES[state.selectedPanel]} panel selected. Drag to reposition its photo.`);
  syncGuides();
  syncComparison();
  syncExportSummary();
  framePending = false;
}

function syncExportSummary() {
  const details = exportDetails(state);
  const encoding = details.quality ? `${details.encoding} ${details.quality}%` : details.encoding;
  byId('export-summary').textContent = `${details.label} / ${details.ratio} · ${details.grade} ${details.intensity}% · ${encoding} · ${details.megapixels} MP`;
  byId('grade-description').textContent = GRADES[state.mood].note;
  exportButton.title = `Download ${details.width} × ${details.height} ${encoding} · ${details.grade} at ${details.intensity}%`;
  byId('encoding-label').textContent = `${encoding} / FULL RESOLUTION`;
  const photo = photoForPanel(state, state.selectedPanel);
  byId('source-photo-info').textContent = photo
    ? `${photo.image.naturalWidth} × ${photo.image.naturalHeight} source · crop saved for ${details.label}`
    : 'Drag on the canvas to reposition';
}

function syncNumberControls() {
  for (const [key, prefix] of Object.entries(numberInputs)) {
    const input = byId(`${prefix}-input`);
    input.min = String(NUMBER_CONTROLS[key].min);
    input.max = String(NUMBER_CONTROLS[key].max);
    input.value = String(state[key]);
    byId(`${prefix}-value`).textContent = `${state[key]}${NUMBER_CONTROLS[key].suffix}`;
  }
}

function syncEncoding() {
  for (const button of document.querySelectorAll('[data-encoding]')) {
    const active = button.dataset.encoding === state.exportType;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = exporting;
  }
  byId('jpeg-quality').value = String(state.jpegQuality);
  byId('jpeg-quality').disabled = state.exportType !== 'jpeg' || exporting;
  if (!exporting) exportButton.querySelector('span').textContent = `Export ${EXPORT_ENCODINGS[state.exportType].name}`;
  syncExportSummary();
}

function syncComparison() {
  const visible = state.compareEnabled && !comparing;
  canvasWrap.classList.toggle('comparison-active', visible);
  byId('compare-toggle').setAttribute('aria-pressed', String(state.compareEnabled));
  for (const id of ['comparison-original', 'comparison-labels', 'compare-handle']) byId(id).hidden = !visible;
  byId('comparison-original').style.clipPath = `inset(0 ${100 - state.comparePosition}% 0 0)`;
  compareHandle.style.left = `${state.comparePosition}%`;
  compareHandle.setAttribute('aria-valuenow', String(state.comparePosition));
  compareHandle.setAttribute('aria-valuetext', `${state.comparePosition}% original, ${100 - state.comparePosition}% graded`);
  byId('comparison-grade-label').textContent = `${GRADES[state.mood].name.toUpperCase()} · ${state.intensity}%`;
}

function toggleComparison() {
  state.compareEnabled = !state.compareEnabled;
  if (!state.compareEnabled && document.activeElement === compareHandle) byId('compare-toggle').focus();
  renderNow();
}

function setComparisonPosition(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  state.comparePosition = Math.round(clampValue(number, 0, 100));
  syncComparison();
}

function comparisonPoint(event) {
  const rect = canvasWrap.getBoundingClientRect();
  return (event.clientX - rect.left) / rect.width * 100;
}

compareHandle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  comparisonPointer = event.pointerId;
  compareHandle.setPointerCapture(event.pointerId);
  compareHandle.focus({ preventScroll: true });
  setComparisonPosition(comparisonPoint(event));
});
compareHandle.addEventListener('pointermove', (event) => {
  if (event.pointerId === comparisonPointer) setComparisonPosition(comparisonPoint(event));
});
function endComparisonDrag(event) {
  if (event.pointerId !== comparisonPointer) return;
  comparisonPointer = null;
  if (compareHandle.hasPointerCapture(event.pointerId)) compareHandle.releasePointerCapture(event.pointerId);
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) compareHandle.addEventListener(name, endComparisonDrag);
compareHandle.addEventListener('keydown', (event) => {
  const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
  if (direction) {
    event.preventDefault();
    setComparisonPosition(state.comparePosition + direction * (event.shiftKey ? 10 : 1));
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    setComparisonPosition(event.key === 'Home' ? 0 : 100);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    toggleComparison();
  }
});

function syncGuides() {
  const area = guideArea(state.size);
  const { width, height } = SIZES[state.size];
  const overlay = byId('safe-area-overlay');
  overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
  overlay.toggleAttribute('hidden', !state.guides);
  for (const [key, value] of Object.entries(area)) byId('safe-area-rect').setAttribute(key, String(value));
  const label = byId('safe-area-label');
  label.setAttribute('x', String(area.x + 12));
  label.setAttribute('y', String(area.y + 28));
  label.textContent = state.size === 'story' ? 'STORY SAFE AREA · 240 PX TOP / BOTTOM' : 'KEEP THE IMPORTANT PART IN HERE';
  byId('guides-toggle').setAttribute('aria-pressed', String(state.guides));
  byId('guide-note').hidden = !state.guides;
}

function syncHistory() {
  const status = history.status();
  for (const action of ['undo', 'redo']) {
    const button = byId(`${action}-button`);
    button.disabled = !status[action] || busyImport || exporting;
    button.title = status[action] ? `${action === 'undo' ? 'Undo' : 'Redo'}: ${status[`${action}Label`]}` : `Nothing to ${action}`;
  }
  byId('history-status').textContent = status.steps ? `${status.steps} edit${status.steps === 1 ? '' : 's'} in this tab` : 'Fresh frame';
  exportButton.disabled = exporting || busyImport || !state.photos.length;
}

function remember(label, group = '') {
  history.record(label, group);
  syncHistory();
}

function restoreEdit(action) {
  if (busyImport || exporting) return;
  const label = history.status()[`${action}Label`];
  if (!history[action]()) return;
  titleInput.value = state.title;
  subtitleInput.value = state.subtitle;
  byId('title-count').textContent = `${state.title.length} / 72`;
  syncNumberControls();
  syncEncoding();
  photoLibrary();
  syncHistory();
  renderNow();
  fitCanvas();
  notify(`${action === 'undo' ? 'Undid' : 'Restored'}: ${label.toLowerCase()}.`);
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
    choose.title = `${photo.name} · ${photo.image.naturalWidth} × ${photo.image.naturalHeight}`;
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
  if (state.panels[state.selectedPanel].photoId === id) return;
  history.finishGroup();
  state.panels[state.selectedPanel].photoId = id;
  resetPanelFraming(state, state.selectedPanel, true);
  remember(`Replace ${PANEL_NAMES[state.selectedPanel]} photo`);
  photoLibrary(); scheduleRender();
}

function removePhoto(id) {
  if (state.photos.length < 2) return;
  history.finishGroup();
  state.photos = state.photos.filter((photo) => photo.id !== id);
  for (const panel of Object.values(state.panels)) {
    if (panel.photoId === id) panel.photoId = state.photos[0].id;
  }
  remember('Remove photo');
  photoLibrary(); scheduleRender();
}

function selectPanel(panel) {
  history.finishGroup();
  state.selectedPanel = panel;
  syncCropControls(); syncButtons(); photoLibrary();
  selectionPolygon.setAttribute('points', layoutFor(state.size).polygons[panel].map((point) => point.join(',')).join(' '));
  syncExportSummary();
}

async function samplePhoto(name) {
  const catalog = globalThis.__VICEFRAME_SAMPLE_CATALOG__;
  if (catalog && !catalog.keys.includes(name)) throw new Error('That scene is not in the offline catalog.');
  const src = globalThis.__VICEFRAME_SAMPLE_DATA__?.[name] || SAMPLE_PATHS[name];
  const label = globalThis.__VICEFRAME_SAMPLE_INFO__?.[name]?.name || (name === 'pier' ? 'The pier' : 'Boulevard');
  if (!cachedSamples.has(name)) cachedSamples.set(name, decodePhoto(src, label, name, true));
  return cachedSamples.get(name);
}

async function useSample(name, announce = true) {
  try {
    const photo = await samplePhoto(name);
    history.finishGroup();
    assignPhotos(state, [photo]); photoLibrary(); renderNow();
    if (announce) {
      remember(`Load ${photo.name}`);
      notify(`${photo.name} is in the frame. Make it yours.`);
    }
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
  history.finishGroup();
  syncHistory();
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
  if (loaded.length) remember(`Import ${loaded.length === 1 ? 'photo' : `${loaded.length} photos`}`);
  else syncHistory();
  if (errors.length) notify(errors[0]);
  else if (files.length > capacity) notify(`Loaded ${loaded.length} photos. The library holds four at a time.`);
  else if (loaded.length) notify(`${loaded.length === 1 ? 'Photo' : `${loaded.length} photos`} loaded. You’re the main event.`);
}

function canvasPoint(event) {
  const rect = coverCanvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * coverCanvas.width / rect.width, y: (event.clientY - rect.top) * coverCanvas.height / rect.height };
}

function cropChange(key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  state.panels[state.selectedPanel].crop[key] = clampValue(number, key === 'zoom' ? 1 : -1, key === 'zoom' ? 3.5 : 1);
  remember(`Adjust ${PANEL_NAMES[state.selectedPanel]} ${key === 'zoom' ? 'zoom' : `${key.toUpperCase()} crop`}`, `crop-${state.selectedPanel}-${key}`);
  syncCropControls(); scheduleRender();
}

function exportName(edit) {
  const title = edit.title.normalize('NFKD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'your-cover';
  const quality = edit.exportType === 'jpeg' ? `-q${edit.jpegQuality}` : '';
  return `viceframe-${title}-${edit.size}-${edit.mood}-i${edit.intensity}${quality}.${EXPORT_ENCODINGS[edit.exportType].extension}`;
}

async function createExport({ encoding = state.exportType, withThumbnail = false } = {}) {
  // Freeze artwork AND encoding before toBlob yields. Recent downloads retain
  // these exact bytes even if the user changes the caption, crop, or quality.
  if (!Object.hasOwn(EXPORT_ENCODINGS, encoding)) throw new Error('Unknown export encoding.');
  const edit = { ...captureEdit(state), exportType: encoding };
  const canvas = document.createElement('canvas');
  renderCover(canvas, edit);
  const thumbnail = withThumbnail ? exportThumbnail(canvas) : null;
  const blob = await canvasImage(canvas, encoding, edit.jpegQuality);
  return {
    blob, thumbnail, width: canvas.width, height: canvas.height,
    filename: exportName(edit), grade: edit.mood, format: edit.size,
    title: edit.title, intensity: edit.intensity, textScale: edit.textScale,
    sublineSize: edit.sublineSize, quality: encoding === 'jpeg' ? edit.jpegQuality : null,
  };
}

function noteExport(output) {
  window.__lastExport = {
    width: output.width, height: output.height, bytes: output.blob.size,
    filename: output.filename, type: output.blob.type, grade: output.grade, format: output.format,
    intensity: output.intensity, quality: output.quality, title: output.title,
    textScale: output.textScale, sublineSize: output.sublineSize,
  };
}

function downloadOutput(output) {
  const url = URL.createObjectURL(output.blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = output.filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  noteExport(output);
}

function renderRecentExports() {
  const list = byId('recent-list');
  list.replaceChildren();
  byId('recent-exports').hidden = !recentExports.length;
  byId('recent-count').textContent = `${recentExports.length} / ${RECENT_EXPORT_LIMIT}`;
  for (const output of recentExports) {
    const card = document.createElement('div');
    card.className = 'recent-card'; card.setAttribute('role', 'listitem');
    const button = document.createElement('button');
    button.className = 'recent-download'; button.dataset.exportId = output.id;
    button.setAttribute('aria-label', `Download ${output.filename} again`);
    button.title = `${output.title || 'Untitled'} · ${GRADES[output.grade].name} at ${output.intensity}%`;
    const image = document.createElement('img');
    image.src = output.thumbnail; image.alt = output.title || 'Untitled cover';
    const label = document.createElement('span');
    const heading = document.createElement('strong');
    const description = document.createElement('small');
    heading.textContent = `${SIZES[output.format].label} · ${output.quality ? `JPEG ${output.quality}%` : 'PNG'}`;
    description.textContent = `${output.width}×${output.height} · ${Math.round(output.blob.size / 1024)} KB`;
    label.append(heading, description); button.append(image, label); card.append(button); list.append(card);
    button.addEventListener('click', () => {
      downloadOutput(output);
      notify(`Re-downloaded your ${SIZES[output.format].label} cover from this session.`);
    });
  }
}

function retainExport(output) {
  recentExports.unshift({ ...output, id: `export-${++exportSequence}` });
  recentExports.splice(RECENT_EXPORT_LIMIT);
  renderRecentExports();
}

async function exportCover() {
  if (exporting || busyImport || !state.photos.length) return;
  exporting = true;
  syncHistory();
  syncEncoding();
  exportButton.querySelector('span').textContent = 'Rendering…';
  try {
    const output = await createExport({ withThumbnail: true });
    downloadOutput(output);
    retainExport(output);
    const encoding = output.quality ? `JPEG ${output.quality}%` : 'PNG';
    notify(`Your ${output.width} × ${output.height} ${encoding} is ready. Go make a scene.`);
  } catch (error) { notify(`Export failed: ${error.message}`); }
  exporting = false;
  syncEncoding();
  syncHistory();
}

titleInput.addEventListener('input', () => {
  state.title = titleInput.value; byId('title-count').textContent = `${state.title.length} / 72`; scheduleRender();
  remember('Edit title', 'title');
});
subtitleInput.addEventListener('input', () => {
  state.subtitle = subtitleInput.value;
  remember('Edit subtitle', 'subtitle');
  scheduleRender();
});
for (const [key, prefix] of Object.entries(numberInputs)) {
  byId(`${prefix}-input`).addEventListener('input', (event) => {
    if (!changeNumber(state, key, event.target.value)) return;
    remember(`Adjust ${NUMBER_CONTROLS[key].label}`, key);
    syncNumberControls();
    scheduleRender();
  });
}
for (const input of [titleInput, subtitleInput, ...Object.values(numberInputs).map((prefix) => byId(`${prefix}-input`)), ...['zoom', 'x', 'y'].map((key) => byId(`${key}-input`))]) {
  input.addEventListener('focus', () => history.finishGroup());
  input.addEventListener('change', () => history.finishGroup());
  input.addEventListener('blur', () => history.finishGroup());
}
byId('undo-button').addEventListener('click', () => restoreEdit('undo'));
byId('redo-button').addEventListener('click', () => restoreEdit('redo'));
function toggleGuides() {
  state.guides = !state.guides;
  syncGuides();
}
byId('guides-toggle').addEventListener('click', toggleGuides);
byId('compare-toggle').addEventListener('click', toggleComparison);
window.addEventListener('keydown', (event) => {
  if (event.altKey || event.isComposing) return;
  const key = event.key.toLowerCase();
  const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
  if (event.ctrlKey || event.metaKey) {
    if (key === 's') {
      event.preventDefault();
      if (!event.repeat) exportCover();
    } else if (!typing && (key === 'z' || key === 'y')) {
      event.preventDefault();
      restoreEdit(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }
    return;
  }
  if (typing || event.repeat) return;
  const actions = {
    g: () => selectGrade(cycleChoice(GRADES, state.mood)),
    f: () => selectFormat(cycleChoice(SIZES, state.size)),
    h: toggleGuides,
    c: toggleComparison,
  };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
});

function compareSource(active) {
  if (comparing === active) return;
  comparing = active;
  byId('compare-original').setAttribute('aria-pressed', String(active));
  byId('compare-original').querySelector('span').textContent = active ? 'Ungraded' : 'Hold original';
  renderNow();
}
byId('compare-original').addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.currentTarget.setPointerCapture(event.pointerId);
  compareSource(true);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
  byId('compare-original').addEventListener(name, () => compareSource(false));
}
byId('compare-original').addEventListener('keydown', (event) => {
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); compareSource(true); }
});
byId('compare-original').addEventListener('keyup', (event) => {
  if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); compareSource(false); }
});
window.addEventListener('blur', () => {
  compareSource(false);
  const pointer = comparisonPointer;
  comparisonPointer = null;
  if (pointer !== null && compareHandle.hasPointerCapture(pointer)) compareHandle.releasePointerCapture(pointer);
});
byId('upload-button').addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => importPhotos(photoInput.files));
panelSource.addEventListener('change', () => selectPhoto(panelSource.value));
exportButton.addEventListener('click', exportCover);
for (const button of document.querySelectorAll('[data-encoding]')) button.addEventListener('click', () => {
  if (exporting || state.exportType === button.dataset.encoding) return;
  history.finishGroup();
  state.exportType = button.dataset.encoding;
  remember(`Choose ${EXPORT_ENCODINGS[state.exportType].name} export`);
  syncEncoding();
});
byId('jpeg-quality').addEventListener('change', (event) => {
  const quality = Number(event.target.value);
  if (!JPEG_QUALITIES.includes(quality) || state.jpegQuality === quality) return;
  history.finishGroup();
  state.jpegQuality = quality;
  remember(`Set JPEG quality to ${quality}%`);
  syncEncoding();
});
byId('clear-recent').addEventListener('click', () => {
  recentExports.length = 0;
  byId('recent-exports').open = false;
  renderRecentExports();
  notify('Recent exports cleared from this tab.');
});
for (const key of ['zoom', 'x', 'y']) byId(`${key}-input`).addEventListener('input', (event) => cropChange(key, event.target.value));
byId('reset-crop').addEventListener('click', () => {
  history.finishGroup();
  resetPanelFraming(state, state.selectedPanel);
  remember(`Reset ${PANEL_NAMES[state.selectedPanel]} crop`);
  syncCropControls();
  scheduleRender();
});
byId('preview-toggle').addEventListener('click', () => {
  state.preview = !state.preview; document.body.classList.toggle('preview-active', state.preview);
  byId('preview-toggle').setAttribute('aria-pressed', String(state.preview));
  byId('preview-toggle').querySelector('span').textContent = state.preview ? 'Edit crop' : 'Preview';
});
function selectFormat(size) {
  history.finishGroup();
  if (!changeFormat(state, size)) return;
  remember(`Switch to ${SIZES[state.size].label}`);
  syncCropControls(); syncButtons(); renderNow(); fitCanvas();
}
function selectGrade(mood) {
  if (!Object.hasOwn(GRADES, mood) || state.mood === mood) return;
  history.finishGroup();
  state.mood = mood;
  remember(`Grade ${GRADES[state.mood].name}`);
  syncButtons(); scheduleRender();
}
document.querySelectorAll('[data-size]').forEach((button) => button.addEventListener('click', () => selectFormat(button.dataset.size)));
document.querySelectorAll('[data-mood]').forEach((button) => button.addEventListener('click', () => selectGrade(button.dataset.mood)));
document.querySelectorAll('[data-panel]').forEach((button) => button.addEventListener('click', () => selectPanel(button.dataset.panel)));
document.querySelectorAll('[data-sample]').forEach((button) => button.addEventListener('click', () => { useSample(button.dataset.sample).catch(() => {}); }));

coverCanvas.addEventListener('pointerdown', (event) => {
  if (state.preview || state.compareEnabled || busyImport || !state.photos.length || event.button !== 0) return;
  history.finishGroup();
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
  const panel = dragState.panel;
  if (coverCanvas.hasPointerCapture(event.pointerId)) coverCanvas.releasePointerCapture(event.pointerId);
  dragState = null; canvasWrap.classList.remove('dragging');
  remember(`Reposition ${PANEL_NAMES[panel]} photo`);
}
coverCanvas.addEventListener('pointerup', endDrag); coverCanvas.addEventListener('pointercancel', endDrag);
coverCanvas.addEventListener('lostpointercapture', () => {
  if (dragState) remember(`Reposition ${PANEL_NAMES[dragState.panel]} photo`);
  dragState = null;
  canvasWrap.classList.remove('dragging');
});
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
    intensity: state.intensity, textScale: state.textScale, sublineSize: state.sublineSize,
    exportType: state.exportType, jpegQuality: state.jpegQuality,
    selectedPanel: state.selectedPanel,
    photos: state.photos.map(({ id, name, sample }) => ({ id, name, sample })),
    panels: JSON.parse(JSON.stringify(state.panels)),
    formatCrops: structuredClone(state.formatCrops),
    guides: state.guides, comparing, history: history.status(),
    compareEnabled: state.compareEnabled, comparePosition: state.comparePosition,
    recentExports: recentExports.map(({ id, filename, format, grade, intensity, quality, blob, title }) => ({
      id, filename, format, grade, intensity, quality, title, bytes: blob.size, type: blob.type,
    })),
  }),
  inspectLayout: () => {
    const layout = layoutFor(state.size);
    return {
      width: layout.w, height: layout.h, polygons: layout.polygons, title: layout.title,
      labels: ['scene', 'detail'].map((panel) => ({ panel, ...panelLabelGeometry(coverCanvas.getContext('2d'), panel, layout) })),
      safeArea: guideArea(state.size),
      headlineScale: state.textScale / 100,
      sublinePixels: state.sublineSize,
    };
  },
  exportPNG: () => createExport({ encoding: 'png' }),
  exportImage: createExport,
};

async function initialize() {
  const sampleName = readViewQuery(state, query);
  titleInput.value = state.title; subtitleInput.value = state.subtitle; byId('title-count').textContent = `${state.title.length} / 72`;
  syncNumberControls();
  syncEncoding();
  await useSample(sampleName, false);
  history.reset();
  syncHistory();
  fitCanvas(); canvasWrap.classList.add('ready'); byId('loading-state').hidden = true; exportButton.disabled = false;
  if (shotMode === 'cover') {
    const output = await createExport({ encoding: 'png' });
    const dataURI = await fileAsDataURI(output.blob);
    const img = byId('export-image'); img.src = dataURI; await img.decode();
    byId('export-preview').hidden = false;
    noteExport(output);
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__shotReady = true;
}
initialize().catch((error) => { byId('loading-state').textContent = error.message; notify(error.message); console.error(error); });
