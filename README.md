# Viceframe — your photo, main-character energy

An original, offline GTA 6–inspired cover-art studio, made as an entry for the
make.fun competition **gta6-cover-art-01 — Make GTA 6 Cover Art**. Cinematic
Miami sunsets, diagonal editorial panels, palm silhouettes, custom-styled
system typography, and a little neon turn your photos into a shareable poster.

## Run

Open **`app/index.html`** in a desktop browser. Everything is local; no build,
internet connection, account, or installation is needed. The self-contained
inline ES-module entry supports direct `file://` opening.
The two sample photos also have a generated, local data-URI companion, so
local-file browser security does not taint the export canvas.

Alternatively, serve `app/` statically, or run the included standard-library
server with **Node 22.18 or newer**:

```sh
node serve.ts
```

Open `http://127.0.0.1:4173`. `PORT` can select another port.

## Make a cover

1. Start with Boulevard or The Pier, or upload/drop **1–4 local photos**.
2. Choose a panel: Hero, Scene, Detail, or Atmosphere. Assign any photo to any
   panel; one photo can fill the entire composition. The atmosphere photo is
   the full-bleed background underneath the three main panels.
3. Drag a photo on the canvas to reposition it. Use zoom and X/Y crop controls
   for precision. Arrow keys reposition the focused canvas; `+` / `−` zoom.
   Each panel keeps its own crop. “Reset” restores that panel's starting crop.
4. Edit the title and optional subtitle, and choose a colour grade and grain.
5. Export a full-resolution PNG:

| Format | PNG dimensions |
| --- | --- |
| Square | **1080 × 1080** |
| Portrait | **1080 × 1350** |
| Wide / landscape | **1920 × 1080** |

The preview and export use the same Canvas 2D renderer. Uploads are decoded
through the File API into data URIs in memory. No photos are uploaded or saved
by the app, and its content-security policy prohibits network connections.

## Deterministic views

```text
?shot=cover&photo=boulevard&caption=VICE%20AFTER%20DARK&size=wide
?shot=cover&photo=pier&caption=PARADISE%20MOST%20WANTED&size=portrait
?shot=editor&photo=boulevard&caption=VICE%20AFTER%20DARK
```

`photo` accepts `boulevard`, `boulevard.jpg`, `pier`, or `pier.jpg`. `size`
accepts `square`, `portrait`, or `wide`. `subtitle` is also supported. Cover
mode displays the app's own exported PNG, fitted without cropping to the
viewport. `window.__shotReady` becomes `true` only after it is painted. Grain,
decorations, and layout are seeded and repeatable.

## Source and packaging

All application code and graphics are original, use no libraries, and ship no
game logo, artwork, character, or font. Only system sans-serif fonts are used.
`app/samples/boulevard.jpg` and `pier.jpg` are the kit's image-model-generated
photos, made for make.fun and free to use. `vendor/makefun-app.ts` is the kit's
required, unchanged dossier helper.

`app/src/` contains the original ES modules. After editing them, refresh the
local-file entry with `node tools/bundle.ts`. The packaging program simply
copies the finished static bytes and four screenshots and builds the dossier:

```sh
MAKEFUN_OUTPUT_DIR=.verification/output node main.ts
```

In the grader it writes to `/output`. It has no dependencies beyond Node's
standard library, and repeated runs produce identical bytes. The four images
in `screenshots/` are genuine Playwright captures, including the app's exported
covers. Application code is MIT licensed; see `LICENSE`.
