export const SIZES = Object.freeze({
  square: { width: 1080, height: 1080, label: 'Square' },
  portrait: { width: 1080, height: 1350, label: 'Portrait' },
  wide: { width: 1920, height: 1080, label: 'Wide' },
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
    selectedPanel: 'hero',
    preview: false,
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
