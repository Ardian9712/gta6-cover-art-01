import { SIZES, EXPORT_ENCODINGS, photoForPanel, clampValue } from './state.js';

export const PALETTES = Object.freeze({
  sunset: { sky: '#4d2563', middle: '#cf4790', sun: '#ffb06a', accent: '#ff6387', cool: '#7ae5df', ink: '#191123', paper: '#fff1d9' },
  neon: { sky: '#141d40', middle: '#76398a', sun: '#f273ba', accent: '#ee57c8', cool: '#60e9eb', ink: '#111325', paper: '#f5e8fb' },
  coast: { sky: '#204759', middle: '#41949e', sun: '#ffc98b', accent: '#ff986f', cool: '#b3efd5', ink: '#142830', paper: '#fff4db' },
  night: { sky: '#071e2a', middle: '#11636c', sun: '#e8b660', accent: '#efbd64', cool: '#5ce2d0', ink: '#06151e', paper: '#fff3ce' },
  vice: { sky: '#10263c', middle: '#1d8ab2', sun: '#ff71ba', accent: '#ff4fa0', cool: '#49f3e8', ink: '#101c31', paper: '#fff1f6' },
});

const gradedImages = new WeakMap();
let filmTexture;

export function layoutFor(size) {
  const { width: w, height: h } = SIZES[size];
  const u = Math.min(w, h) / 1080;
  const m = 26 * u;
  const banner = size === 'banner';
  const wide = size === 'wide' || banner;
  const portrait = size === 'portrait';
  const story = size === 'story';
  const polygons = wide ? {
    hero: [[m, m], [w * .698, m], [w * .664, h - m], [m, h - m]],
    scene: [[w * .718, h * .077], [w - m, m], [w - m, h * .482], [w * .702, h * .504]],
    detail: [[w * .706, h * .529], [w - m, h * .507], [w - m, h - m], [w * .684, h - m]],
    atmosphere: [[0, 0], [w, 0], [w, h], [0, h]],
  } : story ? {
    hero: [[m, m], [w - m, m], [w - m, h * .636], [w * .625, h * .683], [m, h * .649]],
    scene: [[m, h * .674], [w * .55, h * .721], [w * .509, h - m], [m, h - m]],
    detail: [[w * .579, h * .720], [w - m, h * .662], [w - m, h - m], [w * .539, h - m]],
    atmosphere: [[0, 0], [w, 0], [w, h], [0, h]],
  } : {
    hero: [[m, m], [w - m, m], [w - m, h * .653], [w * .605, h * .713], [m, h * .674]],
    scene: [[m, h * .697], [w * .553, h * .739], [w * .512, h - m], [m, h - m]],
    detail: [[w * .578, h * .738], [w - m, h * .677], [w - m, h - m], [w * .538, h - m]],
    atmosphere: [[0, 0], [w, 0], [w, h], [0, h]],
  };
  return {
    size, w, h, u, m, wide, portrait, story, banner, polygons,
    title: banner ? { x: 72, y: 300, width: 1152, height: 228 }
      : wide ? { x: 72, y: 617, width: 1152, height: 337 }
      : story ? { x: 76, y: 862, width: 923, height: 334 }
        : portrait ? { x: 67, y: 635, width: 935, height: 265 }
        : { x: 66, y: 446, width: 935, height: 249 },
    kickerY: banner ? 266 : wide ? 572 : story ? 816 : portrait ? 593 : 405,
    subtitleY: banner ? 568 : wide ? 986 : story ? 1240 : portrait ? 933 : 728,
  };
}

export function boundsFor(polygon) {
  const xs = polygon.map((point) => point[0]);
  const ys = polygon.map((point) => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function geometryFor(image, bounds, crop) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const scale = Math.max(bounds.width / iw, bounds.height / ih) * crop.zoom;
  const sw = bounds.width / scale;
  const sh = bounds.height / scale;
  const overflowX = Math.max(0, iw - sw);
  const overflowY = Math.max(0, ih - sh);
  return {
    sx: overflowX * (clampValue(crop.x, -1, 1) + 1) / 2,
    sy: overflowY * (clampValue(crop.y, -1, 1) + 1) / 2,
    sw, sh, scale, overflowX, overflowY,
  };
}

export function panelAt(size, x, y) {
  const { polygons } = layoutFor(size);
  for (const panel of ['detail', 'scene', 'hero']) {
    const polygon = polygons[panel];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i];
      const b = polygon[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    if (inside) return panel;
  }
  return 'atmosphere';
}

function tracePolygon(ctx, points) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
  ctx.closePath();
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function cinematicImage(photo, mood) {
  let cache = gradedImages.get(photo.image);
  if (!cache) { cache = new Map(); gradedImages.set(photo.image, cache); }
  if (cache.has(mood)) return cache.get(mood);
  const image = photo.image;
  const ratio = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * ratio);
  canvas.height = Math.round(image.naturalHeight * ratio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = pixels.data;
  const luma = new Float32Array(canvas.width * canvas.height);
  for (let i = 0, pixel = 0; i < data.length; i += 4, pixel++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const light = .2126 * r + .7152 * g + .0722 * b;
    luma[pixel] = light;
    const shadow = Math.pow(1 - light / 255, 2);
    const warm = light / 255;
    const saturation = mood === 'vice' ? 1.28 : mood === 'night' ? .96 : mood === 'neon' ? 1.08 : 1.16;
    let rr = light + (r - light) * saturation;
    let gg = light + (g - light) * saturation;
    let bb = light + (b - light) * saturation;
    rr = (rr - 128) * 1.12 + 128;
    gg = (gg - 128) * 1.12 + 128;
    bb = (bb - 128) * 1.12 + 128;
    if (mood === 'sunset') { rr += 14 * warm + 17 * shadow; gg -= 8 * shadow; bb += 19 * shadow - 9 * warm; }
    else if (mood === 'neon') { rr += 5 * warm + 15 * shadow; gg -= 7 * warm; bb += 28 * shadow + 13; }
    else if (mood === 'night') {
      // Split-toning moves dark pixels toward teal and bright pixels toward
      // gold independently, rather than putting a flat colour over the photo.
      const highlight = Math.max(0, (warm - .42) / .58);
      rr = rr * .91 + 34 * highlight - 32 * shadow;
      gg = gg * .94 + 17 * shadow + 14 * highlight;
      bb = bb * .92 + 31 * shadow - 39 * highlight;
    } else if (mood === 'vice') {
      const highlight = Math.max(0, (warm - .35) / .65);
      rr += 38 * highlight - 24 * shadow;
      gg += 28 * shadow - 24 * highlight;
      bb += 42 * shadow + 19 * highlight;
    } else { rr += 10 * warm - 5 * shadow; gg += 7 * shadow; bb += 11 * shadow - 7 * warm; }
    data[i] = rr; data[i + 1] = gg; data[i + 2] = bb;
  }
  // Restrained, original ink contours lend the image an illustrated-poster edge
  // while preserving faces. The contour comes from local luminance, not an asset.
  const width = canvas.width;
  for (let y = 1; y < canvas.height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const edge = Math.abs(luma[p - 1] - luma[p + 1]) + Math.abs(luma[p - width] - luma[p + width]);
      if (edge < 65) continue;
      const strength = Math.min(.16, (edge - 65) / 700);
      const i = p * 4;
      data[i] *= 1 - strength; data[i + 1] *= 1 - strength; data[i + 2] *= 1 - strength;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  cache.set(mood, canvas);
  return canvas;
}

function paintPhotoPixels(ctx, image, bounds, crop) {
  const geometry = geometryFor(image, bounds, crop);
  ctx.drawImage(image, geometry.sx, geometry.sy, geometry.sw, geometry.sh,
    bounds.x, bounds.y, bounds.width, bounds.height);
}

function drawPhoto(ctx, photo, polygon, crop, mood, type, palette, strength) {
  if (!photo) return;
  const bounds = boundsFor(polygon);
  ctx.save();
  tracePolygon(ctx, polygon);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const photoAlpha = ctx.globalAlpha;
  // Keep only five full-strength grades cached. Blending at draw time makes a
  // 101-position intensity control cheap without retaining 101 pixel buffers.
  if (strength < 1) paintPhotoPixels(ctx, photo.image, bounds, crop);
  if (strength > 0) {
    ctx.globalAlpha = strength * photoAlpha;
    paintPhotoPixels(ctx, cinematicImage(photo, mood), bounds, crop);
  }
  const tint = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height);
  tint.addColorStop(0, palette.middle);
  tint.addColorStop(.42, palette.sun);
  tint.addColorStop(1, palette.sky);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = strength * (mood === 'night' ? (type === 'hero' ? .36 : .56) : (type === 'hero' ? .55 : .72));
  ctx.fillStyle = tint;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, bounds.y, 0, bounds.y + bounds.height);
  shade.addColorStop(0, '#110d1c45');
  shade.addColorStop(.34, '#160e2000');
  shade.addColorStop(type === 'hero' ? .58 : .64, '#190d2920');
  shade.addColorStop(1, type === 'hero' ? '#100b20ec' : '#100b2090');
  ctx.fillStyle = shade;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  if (type === 'scene') {
    const glow = ctx.createLinearGradient(bounds.x, 0, bounds.x + bounds.width, 0);
    glow.addColorStop(0, `${palette.accent}50`); glow.addColorStop(1, `${palette.accent}00`);
    ctx.fillStyle = glow;
    ctx.globalAlpha = strength;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  } else if (type === 'detail') {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = palette.cool; ctx.globalAlpha = .4 * strength;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  ctx.restore();
}

function drawPalm(ctx, x, bottom, height, lean, colour) {
  const topX = x + lean * height;
  const topY = bottom - height;
  ctx.save(); ctx.fillStyle = colour; ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.moveTo(x - height * .025, bottom);
  ctx.bezierCurveTo(x - height * .02, bottom - height * .35, topX - height * .025, topY + height * .28, topX - 3, topY);
  ctx.lineTo(topX + 4, topY);
  ctx.bezierCurveTo(topX + height * .014, topY + height * .31, x + height * .031, bottom - height * .3, x + height * .035, bottom);
  ctx.closePath(); ctx.fill();
  const directions = [-3.02, -2.6, -2.08, -1.56, -1.0, -.5, -.05, .46, 1.03, 2.35];
  directions.forEach((angle, index) => {
    const length = height * (.25 + (index % 3) * .035);
    const endX = topX + Math.cos(angle) * length;
    const endY = topY + Math.sin(angle) * length * .55 + length * .24;
    const controlX = topX + Math.cos(angle) * length * .6;
    const controlY = topY + Math.sin(angle) * length * .72 - length * .13;
    ctx.beginPath(); ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo(controlX - Math.sin(angle) * 8, controlY, endX, endY);
    ctx.quadraticCurveTo(controlX + Math.sin(angle) * 8, controlY + 7, topX, topY);
    ctx.fill();
    for (let i = 2; i < 10; i++) {
      const t = i / 11;
      const px = (1 - t) ** 2 * topX + 2 * (1 - t) * t * controlX + t ** 2 * endX;
      const py = (1 - t) ** 2 * topY + 2 * (1 - t) * t * controlY + t ** 2 * endY;
      const leaf = length * .2 * Math.sin(t * Math.PI);
      const tangentX = 2 * (1 - t) * (controlX - topX) + 2 * t * (endX - controlX);
      const tangentY = 2 * (1 - t) * (controlY - topY) + 2 * t * (endY - controlY);
      const tangent = Math.atan2(tangentY, tangentX);
      for (const sign of [-1, 1]) {
        const leafAngle = tangent + sign * 1.08;
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + Math.cos(leafAngle) * leaf * .65, py + Math.sin(leafAngle) * leaf * .7,
          px + Math.cos(leafAngle) * leaf, py + Math.sin(leafAngle) * leaf + length * .04);
        ctx.lineTo(px + Math.cos(tangent) * length * .035, py + Math.sin(tangent) * length * .035);
        ctx.closePath(); ctx.fill();
      }
    }
  });
  ctx.restore();
}

function drawSkyline(ctx, x, baseline, width, unit, palette) {
  const random = seededRandom(626061);
  ctx.save();
  let cursor = x;
  while (cursor < x + width) {
    const buildingWidth = (22 + random() * 35) * unit;
    const height = (24 + random() * 106) * unit;
    ctx.fillStyle = '#170f2999';
    ctx.fillRect(cursor, baseline - height, buildingWidth, height);
    if (random() > .65) ctx.fillRect(cursor + buildingWidth * .4, baseline - height - 14 * unit, 3 * unit, 15 * unit);
    ctx.fillStyle = `${palette.cool}65`;
    for (let yy = baseline - height + 8 * unit; yy < baseline - 5 * unit; yy += 12 * unit) {
      for (let xx = cursor + 5 * unit; xx < cursor + buildingWidth - 4 * unit; xx += 9 * unit) {
        if (random() > .65) ctx.fillRect(xx, yy, 2 * unit, 3 * unit);
      }
    }
    cursor += buildingWidth + 3 * unit;
  }
  ctx.restore();
}

function spacedText(ctx, value, x, y, size, spacing, colour, weight = 700) {
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  ctx.fillStyle = colour;
  ctx.textBaseline = 'alphabetic';
  for (const char of value) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + spacing;
  }
  return x;
}

function titleLines(value) {
  const title = value.trim().toLocaleUpperCase('en-US');
  if (!title) return [];
  const explicit = title.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit.length <= 3 ? explicit : [explicit[0], explicit[1], explicit.slice(2).join(' ')];
  const words = title.replace(/\s+/g, ' ').split(' ');
  if (title.length <= 11 || words.length === 1) return [title];
  if (title.length > 36 && words.length > 4) {
    const lines = ['', '', ''];
    let line = 0;
    for (const word of words) {
      if (line < 2 && lines[line].length + word.length > Math.ceil(title.length / 3)) line++;
      lines[line] += `${lines[line] ? ' ' : ''}${word}`;
    }
    return lines.filter(Boolean);
  }
  let best = 1, score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const next = Math.abs(a / b - .65) + Math.max(a, b) * .004;
    if (next < score) { score = next; best = i; }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

function drawTitle(ctx, text, area, palette, textScale) {
  const lines = titleLines(text);
  if (!lines.length) return;
  const lineHeight = area.height / lines.length;
  const fontSize = Math.min(330, lineHeight / .77);
  const scale = clampValue(textScale, 60, 100) / 100;
  ctx.save();
  ctx.translate(area.x, area.y + area.height * (1 - scale));
  ctx.scale(scale, scale);
  // Custom proportions, slanted cuts and offset ink create original lettering
  // from ordinary system sans-serif, with no game or downloadable font.
  for (const [index, line] of lines.entries()) {
    ctx.save();
    const letterSize = fontSize * (lines.length > 1 && index === 0 && line.length <= 7 ? 1.12 : 1);
    ctx.font = `900 ${letterSize}px "Arial Black", Arial, Helvetica, sans-serif`;
    const measured = ctx.measureText(line).width;
    const scaleX = Math.min(1.12, (area.width - 20) / measured);
    const baseline = lineHeight * (index + 1) - 3;
    ctx.transform(scaleX, 0, -.025, 1, 0, 0);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = letterSize * .075;
    ctx.strokeText(line, 5, baseline + 8);
    ctx.fillStyle = palette.accent;
    ctx.fillText(line, 5, baseline + 6);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = letterSize * .032;
    ctx.strokeText(line, 5, baseline + 6);
    ctx.strokeStyle = '#211326';
    ctx.lineWidth = letterSize * .062;
    ctx.strokeText(line, 0, baseline);
    const fill = ctx.createLinearGradient(0, baseline - letterSize * .7, 0, baseline);
    fill.addColorStop(0, '#fff8e9'); fill.addColorStop(.7, palette.paper); fill.addColorStop(1, '#f9c3a8');
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    ctx.lineWidth = letterSize * .032;
    ctx.strokeText(line, 0, baseline);
    ctx.fillText(line, 0, baseline);
    ctx.restore();
  }
  ctx.restore();
}

function spanAt(polygon, y) {
  const crossings = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (a[1] === b[1] || y < Math.min(a[1], b[1]) || y > Math.max(a[1], b[1])) continue;
    crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
  }
  return crossings.length > 1 ? [Math.min(...crossings), Math.max(...crossings)] : null;
}

export function edgeClearance(point, polygon) {
  let distance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const along = clampValue(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    distance = Math.min(distance, Math.hypot(point[0] - a[0] - along * dx, point[1] - a[1] - along * dy));
  }
  return distance;
}

export function panelLabelGeometry(ctx, panel, layout) {
  const polygon = layout.polygons[panel];
  const bounds = boundsFor(polygon);
  const label = panel === 'scene' ? 'THE GETAWAY' : 'THE OTHER SIDE';
  const fontSize = layout.wide ? 13 : 12;
  const spacing = 1.6;
  ctx.save();
  ctx.font = `700 ${fontSize}px Arial, Helvetica, sans-serif`;
  const textWidth = Array.from(label).reduce((sum, char) => sum + ctx.measureText(char).width + spacing, 0) - spacing;
  ctx.restore();
  const width = Math.ceil(68 + textWidth + 16);
  const height = 46;
  const inset = 16;
  const reserved = layout.wide && panel === 'scene'
    ? [{ x: layout.w - 134, y: 31, width: 104, height: 109 }]
    : [];
  // A bounding box's left edge can lie outside a diagonal panel near its top.
  // Find an entire horizontal slab inside the real polygon, including a normal
  // inset from every edge. All four corners are checked, not just the anchor.
  for (let y = Math.ceil(bounds.y + inset); y < bounds.y + bounds.height - height - 80; y += 4) {
    const spans = [y, y + height / 2, y + height].map((row) => spanAt(polygon, row));
    if (spans.some((span) => !span)) continue;
    const left = Math.max(...spans.map((span) => span[0])) + inset;
    const right = Math.min(...spans.map((span) => span[1])) - inset;
    for (let x = Math.ceil(left); x + width <= right; x += 8) {
      const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
      if (corners.some((point) => edgeClearance(point, polygon) < inset)) continue;
      if (reserved.some((area) => x < area.x + area.width && x + width > area.x && y < area.y + area.height && y + height > area.y)) continue;
      return { x, y, width, height, label, number: panel === 'scene' ? '02' : '03', fontSize, spacing, textWidth, inset, corners, reserved };
    }
  }
  throw new Error(`No readable label rail fits ${panel} in ${SIZES[layout.size].label}.`);
}

function drawPanelLabel(ctx, panel, layout, palette) {
  const rail = panelLabelGeometry(ctx, panel, layout);
  ctx.save();
  ctx.translate(rail.x, rail.y);
  ctx.fillStyle = `${palette.ink}dd`;
  ctx.fillRect(0, 0, rail.width, rail.height);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(10, 8, 40, 30);
  ctx.font = '900 21px Arial, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = palette.ink;
  ctx.fillText(rail.number, 17, 31);
  spacedText(ctx, rail.label, 68, 28, rail.fontSize, rail.spacing, palette.paper);
  ctx.fillStyle = palette.accent;
  ctx.fillRect(68, 35, rail.textWidth, 2);
  ctx.restore();
}

function drawTexture(ctx, layout, amount) {
  if (!amount) return;
  if (!filmTexture) {
    filmTexture = document.createElement('canvas'); filmTexture.width = 192; filmTexture.height = 192;
    const tx = filmTexture.getContext('2d');
    const pixels = tx.createImageData(192, 192);
    const random = seededRandom(26061986);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = random() > .5 ? 255 : 0;
      pixels.data[i] = value; pixels.data[i + 1] = value; pixels.data[i + 2] = value;
      pixels.data[i + 3] = Math.floor(random() * 65);
    }
    tx.putImageData(pixels, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = amount / 100;
  ctx.fillStyle = ctx.createPattern(filmTexture, 'repeat'); ctx.fillRect(0, 0, layout.w, layout.h);
  ctx.restore();
}

export function renderCover(canvas, state, { ungraded = false } = {}) {
  const layout = layoutFor(state.size);
  const { w, h, u, m, polygons } = layout;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  const palette = PALETTES[state.mood];
  const strength = ungraded ? 0 : clampValue(state.intensity, 0, 100) / 100;
  ctx.resetTransform(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = palette.ink; ctx.fillRect(0, 0, w, h);
  const atmosphere = photoForPanel(state, 'atmosphere');
  if (atmosphere) {
    ctx.save(); ctx.filter = 'blur(15px)'; ctx.globalAlpha = .65;
    drawPhoto(ctx, atmosphere, polygons.atmosphere, state.panels.atmosphere.crop, state.mood, 'atmosphere', palette, strength);
    ctx.restore();
  }
  const sky = ctx.createLinearGradient(w * .05, 0, w * .85, h);
  sky.addColorStop(0, palette.sky); sky.addColorStop(.4, palette.middle); sky.addColorStop(.68, palette.sun); sky.addColorStop(1, palette.sky);
  ctx.globalAlpha = .85; ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;

  for (const panel of ['hero', 'scene', 'detail']) {
    ctx.save(); tracePolygon(ctx, polygons[panel]);
    ctx.shadowColor = '#08050c'; ctx.shadowBlur = 22 * u; ctx.shadowOffsetY = 6 * u;
    ctx.fillStyle = palette.ink; ctx.fill(); ctx.restore();
    drawPhoto(ctx, photoForPanel(state, panel), polygons[panel], state.panels[panel].crop, state.mood, panel, palette, strength);
    ctx.save(); tracePolygon(ctx, polygons[panel]); ctx.strokeStyle = '#17101f'; ctx.lineWidth = 9 * u; ctx.stroke();
    ctx.lineWidth = 1.3 * u; ctx.strokeStyle = `${palette.paper}ae`; ctx.stroke(); ctx.restore();
  }

  // All silhouettes, light trails, skyline and editorial marks are generated.
  ctx.save(); tracePolygon(ctx, polygons.hero); ctx.clip();
  const sunX = layout.wide ? 191 : 142;
  const sunY = layout.banner ? 145 : layout.wide ? 244 : layout.story ? 343 : layout.portrait ? 269 : 206;
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 175 * u);
  halo.addColorStop(0, `${palette.sun}66`); halo.addColorStop(.48, `${palette.accent}26`); halo.addColorStop(1, `${palette.accent}00`);
  ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = .16; ctx.fillStyle = palette.sun;
  ctx.beginPath(); ctx.arc(sunX, sunY, 66 * u, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = .14; ctx.strokeStyle = palette.paper; ctx.lineWidth = 2 * u;
  for (let i = 0; i < 6; i++) {
    const yy = sunY + i * 8;
    const half = Math.sqrt(Math.max(0, 66 ** 2 - (yy - sunY) ** 2));
    ctx.beginPath(); ctx.moveTo(sunX - half, yy); ctx.lineTo(sunX + half, yy); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const baseline = layout.banner ? 468 : layout.wide ? 778 : layout.story ? 1117 : layout.portrait ? 832 : 635;
  drawSkyline(ctx, layout.wide ? 832 : 637, baseline, layout.wide ? 550 : 420, u, palette);
  drawPalm(ctx, layout.wide ? 58 : 39, baseline + 80, layout.banner ? 252 : layout.story ? 642 : layout.portrait ? 459 : 367, -.025, '#181025b0');
  drawPalm(ctx, layout.wide ? 1237 : 1021, baseline + 53, layout.banner ? 232 : layout.story ? 589 : layout.portrait ? 438 : 345, -.12, '#160e26b0');
  ctx.restore();

  // Neon seam: one clean luminous cut, rather than a uniform template border.
  ctx.save(); ctx.strokeStyle = palette.cool; ctx.lineWidth = 3 * u;
  ctx.shadowColor = palette.cool; ctx.shadowBlur = 11 * u;
  ctx.beginPath();
  if (layout.wide) { ctx.moveTo(w * .691, h * .53); ctx.lineTo(w * .676, h * .956); }
  else if (layout.story) { ctx.moveTo(w * .588, h * .710); ctx.lineTo(w * .958, h * .658); }
  else { ctx.moveTo(w * .587, h * .726); ctx.lineTo(w * .958, h * .674); }
  ctx.stroke(); ctx.restore();

  spacedText(ctx, 'VICE CITY / FLORIDA', 65 * u, 69 * u, 13 * u, 2.5 * u, palette.paper);
  spacedText(ctx, '25°46′ N   80°12′ W', 65 * u, 93 * u, 9 * u, 1.6 * u, `${palette.paper}b0`, 500);
  ctx.strokeStyle = `${palette.paper}b0`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(65, 108); ctx.lineTo(layout.wide ? 573 : 443, 108); ctx.stroke();

  const badgeX = w - 83 * u;
  ctx.save(); ctx.translate(badgeX, 85 * u); ctx.rotate(.09);
  ctx.strokeStyle = palette.paper; ctx.lineWidth = 1.5 * u;
  ctx.beginPath(); ctx.arc(0, 0, 39 * u, 0, Math.PI * 2); ctx.stroke();
  ctx.font = `900 ${31 * u}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = palette.paper; ctx.fillText('06', 0, 3 * u);
  ctx.font = `700 ${7 * u}px Arial, sans-serif`; ctx.fillText('VOL. / VICEFRAME', 0, 17 * u); ctx.restore();

  const kicker = 'MAKE YOUR OWN RULES.';
  ctx.save(); ctx.translate(layout.title.x + 3, layout.kickerY); ctx.rotate(-.025);
  ctx.fillStyle = palette.accent;
  tracePolygon(ctx, [[-5, -21], [264, -21], [254, 6], [-15, 6]]); ctx.fill();
  spacedText(ctx, kicker, 0, -3, 12, 1.45, '#241225'); ctx.restore();

  drawTitle(ctx, state.title, layout.title, palette, state.textScale);
  if (state.subtitle.trim()) {
    const subtitle = state.subtitle.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
    ctx.save();
    const fontSize = clampValue(state.sublineSize, 10, 24);
    const spacing = fontSize * .09;
    ctx.font = `700 ${fontSize}px Arial, sans-serif`;
    const measured = ctx.measureText(subtitle).width + subtitle.length * spacing;
    const available = layout.wide ? 1120 : 915;
    ctx.translate(layout.title.x, layout.subtitleY);
    ctx.scale(Math.min(1, available / measured), 1);
    ctx.fillStyle = '#171020ce'; ctx.fillRect(-10, -fontSize - 5, measured + 20, fontSize + 14);
    spacedText(ctx, subtitle, 0, 0, fontSize, spacing, palette.paper, 700);
    ctx.restore();
  }
  drawPanelLabel(ctx, 'scene', layout, palette);
  drawPanelLabel(ctx, 'detail', layout, palette);

  const footerY = h - 47 * u;
  ctx.fillStyle = '#170f22e8'; ctx.fillRect(m, footerY - 22 * u, w - m * 2, 44 * u);
  spacedText(ctx, 'PALMS. HEAT. NO TURNING BACK.', 60 * u, footerY + 2 * u, 10 * u, 2 * u, palette.paper);
  const editionX = layout.wide ? w - 414 : w - 367;
  spacedText(ctx, 'AN ORIGINAL / VICEFRAME', editionX, footerY + 2, 8, 1.4, `${palette.paper}ad`, 500);
  const random = seededRandom(601086);
  let barX = w - 141;
  ctx.fillStyle = palette.paper;
  while (barX < w - 58) { const bw = random() > .55 ? 3 : 1; ctx.fillRect(barX, footerY - 12, bw, 22); barX += bw + 2; }
  ctx.strokeStyle = '#ffcab688'; ctx.lineWidth = 1;
  ctx.strokeRect(10 * u, 10 * u, w - 20 * u, h - 20 * u);
  ctx.fillStyle = palette.cool;
  for (const [xx, yy] of [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]]) {
    ctx.fillRect(xx - 5, yy - 1, 10, 2); ctx.fillRect(xx - 1, yy - 5, 2, 10);
  }
  drawTexture(ctx, layout, state.grain);
  return canvas;
}

export function canvasPNG(canvas) {
  return canvasImage(canvas, 'png');
}

export function canvasImage(canvas, encoding, quality = 85) {
  const type = EXPORT_ENCODINGS[encoding];
  if (!type) return Promise.reject(new Error('Choose PNG or JPEG for your export.'));
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== type.mime) reject(new Error(`The browser could not create the ${type.name}.`));
      else resolve(blob);
    }, type.mime, quality / 100);
  });
}

export function exportThumbnail(canvas) {
  const thumbnail = document.createElement('canvas');
  const ratio = Math.min(1, 160 / Math.max(canvas.width, canvas.height));
  thumbnail.width = Math.max(1, Math.round(canvas.width * ratio));
  thumbnail.height = Math.max(1, Math.round(canvas.height * ratio));
  const ctx = thumbnail.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.toDataURL('image/jpeg', .7);
}
