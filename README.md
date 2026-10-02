# Jigsta

A web app for planning your Instagram grid: import what's already posted, drop in new
photos, and drag them around to see how the profile will look.

A single-page web app — plain HTML/JS, no build step, no dependencies. Serve the `Web/` folder
with the bundled `serve.py` (a static server that stops browsers caching stale scripts):

```bash
python3 serve.py 5777          # http://127.0.0.1:5777
```

Everything (grid state + photos) lives in the browser's IndexedDB; nothing is uploaded.
Use **Back up… / Restore…** in the sidebar to keep a copy, since browsers can clear site data.

- **Your existing grid** comes from Instagram's data export (Accounts Center ▸ Download your
  information ▸ **JSON** format). Drop the .zip on the page (or pick the unzipped folder); re-importing a newer
  export only adds new posts.
- **Ideas tray** (right): drop photos from Finder or use *Add photos…*. Drag onto the grid to plan.
- **Planned tiles** have a blue outline and a number = posting order (#1 goes up first).
  Hover for ✓ *I posted this* or ↩ *back to Ideas*. Posted tiles can be pinned (max 3).
- ⌘Z / ⇧⌘Z undo/redo, 3:4 (current Instagram) or 1:1 tiles, *Fade posted*, *Clean preview*.

Layout (`Web/`): `app.js` state, rendering, drag & drop · `importer.js` Instagram export parsing ·
`zip.js` zip reader (deflate + ZIP64, via `DecompressionStream`) and writer for backups ·
`db.js` IndexedDB wrapper.
