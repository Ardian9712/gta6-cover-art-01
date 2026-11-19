export const SIZES = Object.freeze({
  square: { width: 1080, height: 1080, label: 'Square' },
  portrait: { width: 1080, height: 1350, label: 'Portrait' },
  wide: { width: 1920, height: 1080, label: 'Wide' },
  story: { width: 1080, height: 1920, label: 'Story' },
  banner: { width: 1920, height: 640, label: 'Banner' },
});

export const GRADES = Object.freeze({
  sunset: { name: 'Vice sunset', note: 'Coral skies. Warm skin. The golden hour, turned up.' },
  neon: { name: 'Neon noir', note: 'Electric violet and pink for your after-dark chapter.' },
  coast: { name: 'Ocean drive', note: 'Sea-glass greens and peach light. A coastal daydream.' },
  night: { name: 'Ocean night', note: 'Ocean Drive at midnight: deep teal shadows, liquid-gold light.' },
  vice: { name: 'Neon Vice', note: 'Hot-pink highlights. Cyan shadows. Your electric alter ego.' },
});

export const EXPORT_ENCODINGS = Object.freeze({
  png: { name: 'PNG', mime: 'image/png', extension: 'png' },
  jpeg: { name: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
});
export const JPEG_QUALITIES = Object.freeze([70, 85, 95]);
export const RECENT_EXPORT_LIMIT = 6;
export const NUMBER_CONTROLS = Object.freeze({
  grain: { min: 0, max: 40, label: 'film grain', suffix: '%' },
  intensity: { min: 0, max: 100, label: 'grade intensity', suffix: '%' },
  textScale: { min: 60, max: 100, label: 'headline size', suffix: '%' },
  sublineSize: { min: 10, max: 24, label: 'subline size', suffix: ' px' },
});

export const PANEL_NAMES = Object.freeze({ hero: 'Hero', scene: 'Scene', detail: 'Detail', atmosphere: 'Atmosphere' });
export const SAMPLE_PATHS = Object.freeze({ boulevard: './samples/boulevard.jpg', pier: './samples/pier.jpg' });

export function freshCrop(panel) {
  const starts = {
    hero: { zoom: 1, x: 0, y: -0.45 },
    scene: { zoom: 1.7, x: -0.68, y: 0.72 },
    detail: { zoom: 1.45, x: 0.62, y: -0.62 },
    atmosphere: { zoom: 1, x: 0, y: 0 },
  };
  return { ...starts[panel] };
}

export function makeState() {
  return {
    size: 'square',
    mood: 'sunset',
    title: 'VICE AFTER DARK',
    subtitle: 'A LITTLE DANGER LOOKS GOOD ON YOU.',
    grain: 18,
    intensity: 100,
    textScale: 100,
    sublineSize: 15,
    exportType: 'png',
    jpegQuality: 85,
    selectedPanel: 'hero',
    preview: false,
    guides: false,
    compareEnabled: false,
    comparePosition: 50,
    formatCrops: {},
    photos: [],
    panels: Object.fromEntries(Object.keys(PANEL_NAMES).map((key) => [key, { photoId: null, crop: freshCrop(key) }])),
  };
}

export function decodePhoto(src, name, id, sample = false) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) reject(new Error('This photo has no image pixels.'));
      else resolve({ src, name, id, sample, image });
    };
    image.onerror = () => reject(new Error(`Couldn't read ${name}. Try a JPG, PNG, or WEBP photo.`));
    image.src = src;
  });
}

export function fileAsDataURI(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name || 'this photo'}.`));
    reader.readAsDataURL(file);
  });
}

export function assignPhotos(state, photos, reset = true) {
  state.photos = photos;
  if (reset) state.formatCrops = {};
  for (const [index, panel] of Object.keys(PANEL_NAMES).entries()) {
    state.panels[panel].photoId = photos[index % photos.length]?.id || null;
    if (reset) state.panels[panel].crop = photos.length === 1 || panel === 'hero' || panel === 'atmosphere'
      ? freshCrop(panel)
      : { zoom: 1, x: 0, y: -0.2 };
  }
}

export function photoForPanel(state, panel) {
  return state.photos.find((photo) => photo.id === state.panels[panel].photoId) || state.photos[0];
}

export function clampValue(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function cycleChoice(choices, current) {
  const keys = Object.keys(choices);
  return keys[(keys.indexOf(current) + 1) % keys.length];
}

export function changeNumber(state, key, value) {
  const control = NUMBER_CONTROLS[key];
  const number = Number(value);
  if (!control || !Number.isFinite(number)) return false;
  const next = Math.round(clampValue(number, control.min, control.max));
  if (state[key] === next) return false;
  state[key] = next;
  return true;
}

export function changeFormat(state, size) {
  if (!Object.hasOwn(SIZES, size) || size === state.size) return false;
  state.formatCrops[state.size] = Object.fromEntries(
    Object.entries(state.panels).map(([key, panel]) => [key, { ...panel.crop }]),
  );
  state.size = size;
  for (const [key, panel] of Object.entries(state.panels)) {
    // A first visit carries the current framing forward; return visits recover
    // that format's exact crops, so a Story edit cannot spoil a square cover.
    panel.crop = { ...(state.formatCrops[size]?.[key] || panel.crop) };
  }
  return true;
}

export function resetPanelFraming(state, panel, allFormats = false) {
  state.panels[panel].crop = freshCrop(panel);
  if (allFormats) for (const crops of Object.values(state.formatCrops)) delete crops[panel];
}

export function guideArea(size) {
  const { width, height } = SIZES[size];
  const horizontal = Math.round(width * .065);
  const vertical = size === 'story' ? 240 : Math.round(height * .07);
  return { x: horizontal, y: vertical, width: width - horizontal * 2, height: height - vertical * 2 };
}

export function readViewQuery(state, query) {
  if (query.has('caption')) state.title = query.get('caption').slice(0, 72);
  if (query.has('subtitle')) state.subtitle = query.get('subtitle').slice(0, 100);
  if (Object.hasOwn(SIZES, query.get('size'))) state.size = query.get('size');
  if (Object.hasOwn(GRADES, query.get('mood'))) state.mood = query.get('mood');
  for (const key of Object.keys(NUMBER_CONTROLS)) {
    if (query.has(key) && query.get(key).trim()) changeNumber(state, key, query.get(key));
  }
  if (Object.hasOwn(EXPORT_ENCODINGS, query.get('encoding'))) state.exportType = query.get('encoding');
  const quality = Number(query.get('quality'));
  if (JPEG_QUALITIES.includes(quality)) state.jpegQuality = quality;
  const position = Number(query.get('split'));
  if (query.has('split') && query.get('split').trim() && Number.isFinite(position)) {
    state.comparePosition = Math.round(clampValue(position, 0, 100));
  }
  state.compareEnabled = query.get('compare') === '1';
  state.guides = query.get('guides') === '1';
  const requestedPhoto = (query.get('photo') || 'boulevard').replace(/\.jpg$/i, '').toLowerCase();
  return Object.hasOwn(SAMPLE_PATHS, requestedPhoto) ? requestedPhoto : 'boulevard';
}

export function exportDetails(state) {
  const { width, height, label } = SIZES[state.size];
  const divisor = (a, b) => b ? divisor(b, a % b) : a;
  const unit = divisor(width, height);
  return {
    width, height, label,
    ratio: `${width / unit}:${height / unit}`,
    grade: GRADES[state.mood].name,
    intensity: state.intensity,
    encoding: EXPORT_ENCODINGS[state.exportType].name,
    quality: state.exportType === 'jpeg' ? state.jpegQuality : null,
    megapixels: (width * height / 1000000).toFixed(2),
  };
}
