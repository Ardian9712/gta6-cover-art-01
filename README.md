[![Make GTA 6 Cover Art](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![Live rank](https://make.fun/badge/gta6-cover-art-01/Ardian9712/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![Live reward](https://make.fun/badge/gta6-cover-art-01/Ardian9712/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01)

# Viceframe · make your electric alter ego

Your photo becomes a cinematic Miami cover: diagonal frames, oversized type,
illustrated palms, and neon seams. This offline studio is an entry in
[Make GTA 6 Cover Art — gta6-cover-art-01](https://make.fun/bounty/gta6-cover-art-01).

**Revision 2** adds Neon Vice grading with adjustable intensity, independent
headline/subline sizing, a panoramic Banner, keyboard commands, a draggable
before/after reveal, JPEG quality options, and six recent exports in this tab.

## Open the studio

Double-click **`app/index.html`** in a current browser. Photos, samples, and
rendering work directly from `file://`; the finished app needs no installation.
The generated classic-script entry loads locally and uses no module imports.

For an HTTP preview with **Node.js 22.18 or newer**:

```sh
npm start
```

Open `http://127.0.0.1:4173`. `PORT` selects a different loopback port. Any
ordinary static server can also serve `app/`. There are no app dependencies.

## Build a cover in six moves

1. Upload or drop **one to four JPG, PNG, or WEBP photos**, or try **Boulevard**
   and **The pier**. The first upload replaces the built-in sample.
2. Pick **Hero**, **Scene**, **Detail**, or **Atmosphere** and assign a photo.
   Each panel has its own framing, and a photo can fill multiple panels.
3. Drag the photo on the canvas. Adjust **Zoom**, **X**, and **Y** for precision,
   or reset the selected panel's crop. Crops are remembered for each format.
4. Write the headline and subline; set their sizes. Line breaks and automatic
   title fitting make a short name or a three-line story work in the same frame.
5. Choose a grade and intensity. Sweep **Compare** across the cover to inspect
   the original photographic treatment alongside the graded treatment.
6. Select **PNG** or **JPEG**, pick JPEG quality, and export. Open **Recent
   exports** to download any of the last six captured files again.

### Five compositions

| Frame / query key | Output pixels | Ratio |
| --- | --- | --- |
| Square / `square` | 1080 × 1080 | 1:1 |
| Portrait / `portrait` | 1080 × 1350 | 4:5 |
| Wide / `wide` | 1920 × 1080 | 16:9 |
| Story / `story` | 1080 × 1920 | 9:16 |
| **Banner / `banner`** | **1920 × 640** | **3:1** |

The new Banner is a distinct panoramic composition with its own title placement,
sun, skyline, palm heights, and crop memory. The existing Wide and Portrait
already cover the 1920 × 1080 and 1080 × 1350 sizes suggested for this revision.
All five frames use fully padded `02 / THE GETAWAY` and `03 / THE OTHER SIDE`
label rails measured against the actual diagonal panel edges.

### Five ways to chase the light

| Grade / query key | Photographic treatment |
| --- | --- |
| Vice sunset / `sunset` | Coral, amber, and violet shadows |
| Neon noir / `neon` | Electric pink and deep violet |
| Ocean drive / `coast` | Sea-glass greens and peach daylight |
| Ocean night / `night` | Teal shadows and liquid-gold highlights |
| **Neon Vice / `vice`** | **Cyan shadows and hot-pink highlights** |

**Grade intensity: 0–100%.** Zero shows ungraded photo pixels; 100 applies the
complete photographic treatment. Intermediate values blend both real renders.
The selected grade also supplies the cover's lettering and accent palette.
Full-strength grades are cached per photo, so adjusting intensity does not
create a separate full-size pixel buffer for every slider position.

**Headline size: 60–100%** of the automatically fitted title. Scaling is anchored
at the bottom of its title area. **Subline size: 10–24 pixels** at export
resolution. Both controls repaint immediately and participate in edit history.
Optional film grain uses a deterministic texture and a separate 0–40% control.

## Compare, crop, and recover an edit

**Compare** places the original photo treatment on the left and the graded
treatment on the right. Drag the mint divider; it follows the pointer even
outside the image and clamps to either edge. Its keyboard-accessible slider
supports arrows, `Shift` + arrows for ten-point jumps, `Home`, and `End`.
`Escape` closes comparison and returns focus to the Compare button.

The reveal keeps its percentage when the format changes and refreshes its
original render when a crop or caption changes. **Hold original** provides a
quick temporary comparison with a mouse press or focused `Space`/`Enter` hold.

**Undo/Redo** retains 50 artwork and output-preference edits: imports, removals,
captions, type sizing, grades, intensity, grain, crops, encoding, and JPEG quality.
A continuous slider gesture or typing run occupies one step. A new edit after
Undo starts a new branch. Decoded photo references are shared between snapshots.

**Guides** shows the composition-safe rectangle. Story reserves 240 output
pixels at the top and bottom. Guides, selection outlines, and comparisons are
editor views; the export path renders the finished graded cover on a new canvas.

| Command | Keys |
| --- | --- |
| Cycle all five grades | `G` |
| Cycle all five formats | `F` |
| Toggle safe-area guides | `H` |
| Toggle split comparison | `C` |
| Export the selected file type | `Ctrl`/`⌘` + `S` |
| Undo / redo outside input fields | `Ctrl`/`⌘` + `Z` / `Shift` + `Z` |
| Reposition a focused cover | Arrow keys |
| Zoom a focused cover | `+`, `−`, or mouse wheel |

Letter commands are ignored while typing, choosing an input value, or composing
text. Export works from a focused text field. Repeated keydown events do not
cycle choices or create repeated shortcut downloads.

## Export once; download the same file again

**PNG** is lossless. **JPEG 70%** favors smaller files, **85%** is a balanced
default, and **95%** retains more detail. JPEG quality is remembered while PNG
is selected. Output dimensions always match the format, including full-size
Story and Banner exports, regardless of the preview's display size.

The encoder captures caption, crops, grade strength, typography, and quality
before it starts. Filenames include the title, frame, grade, intensity, and
JPEG quality. A later edit cannot change an export already being encoded.

The **Recent exports** drawer holds the last six blobs and small thumbnails,
newest first. Clicking a thumbnail downloads its exact captured bytes and
filename. Re-downloads do not add another entry or alter the current cover.
**Clear** releases the retained entries; closing the tab releases the session.

## Local from beginning to end

The File API decodes photos into in-memory data URIs. Sample JPEG bytes are
bundled locally. There is no account, upload API, analytics, cookie, remote font,
or service worker. The content-security policy includes `connect-src 'none'`.
The disk-opened studio and all tested editing/export actions make zero network
requests. Session history and recent exports use memory, with explicit limits.

## Repeatable `?shot=` views

Append a query to `app/index.html`, for example:

```text
?shot=cover&size=story&mood=vice&photo=boulevard&caption=VICE%20AFTER%20DARK&intensity=100
?shot=cover&size=portrait&mood=coast&photo=pier&textScale=92&sublineSize=18
?shot=editor&size=square&mood=vice&intensity=75&compare=1&split=42&encoding=jpeg&quality=85
```

| Query | Values |
| --- | --- |
| `shot` | `cover`, `editor` |
| `size`, `mood` | Keys in the format and grade tables |
| `photo` | `boulevard`, `pier`, optionally with `.jpg` |
| `caption`, `subtitle` | Up to 72 / 100 characters |
| `intensity`, `grain` | 0–100 / 0–40 |
| `textScale`, `sublineSize` | 60–100 / 10–24 |
| `compare`, `split` | `1` enables the reveal; 0–100 sets its position |
| `encoding`, `quality` | `png`, `jpeg` / 70, 85, 95 |
| `guides` | `1` enables editor guides |

Invalid choices use defaults; finite numeric values clamp to their limits and
blank numeric values preserve defaults. Cover mode shows the app's clean
exported **PNG**, fitted proportionally to the viewport. Editor encoding and
comparison preferences can be tested independently in its live view.
`window.__shotReady` signals decoded, painted readiness. Read-only diagnostics
expose state, layout, session metadata, and pure PNG/selected-encoding exports.

## Develop, capture, and verify

Edit the four canonical modules in `app/src/`. The deterministic bundler creates
`app/studio.min.js`, updates the local script marker in `app/index.html`, and
refreshes the sample catalog. The generated runtime is closed-scope and parsed
as the exact classic script the browser loads. Canonical sources remain readable
in the dossier's source-text budget.

```sh
npm run bundle
npm run check
npm run verify:server
npm run verify:browser
npm run screenshots
npm run verify:images
MAKEFUN_OUTPUT_DIR=.verification/pass-2/output-a node main.ts
MAKEFUN_OUTPUT_DIR=.verification/pass-2/output-b node main.ts
npm run verify:package
git add -N app/studio.min.js
npm run audit
git diff --check
```

Playwright **MCP** drives the real browser, uploads, downloads, and screenshots.
The client uses cached Chromium and offline packages; `VICEFRAME_BROWSER` can
select an installed executable. Temporary profiles and recordings live inside
the ignored repository directories. Python/Pillow independently decodes images
and inspects JPEG quantization tables without modifying any screenshot.

The browser suite checks all 25 format/grade pairs and enforces 45+ checks. It
covers actual crop drags, sizing, intensity, shortcuts, split-slider input,
PNG/JPEG downloads, recent-byte identity, uploads, responsive layouts, and
deterministic views. Evidence goes in **`.verification/pass-2/`**. App fingerprints
bind the browser and capture reports to the exact bytes being packaged.

`main.ts` uses the verbatim kit dossier helper, validates all size/entry caps,
and writes the static app plus four screenshots to `MAKEFUN_OUTPUT_DIR`
(default `/output`). Two builds must have identical trees and file bytes;
`dossier.json` must be below 1.5 MiB with all original app source included.
The authorship audit compares with the pass-1 baseline `46d605e`, checks all
21 required owned files, and reports both Git new-line totals and an independent
novel-source percentage that excludes generated bundles and photo data.

## Original work and license

The original application, generated Canvas artwork, and tooling use the MIT
license in `LICENSE`. Lettering uses system sans-serif. The two permitted kit
JPEGs and `vendor/makefun-app.ts` retain their exact kit bytes. Package and
authorship verification independently check those protected copies.

---

Build something worth sharing: [join make.fun](https://make.fun/r/p8atzycs).
