'use strict';

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const tray = $('#tray');

// ---------- state ----------
// items:   id → { id, file, key?, ts?, caption?, count?, video? }
// posted:  ids already on Instagram, newest first
// pinned:  subset of posted shown first (Instagram allows 3)
// planned: ids previewed above the posted grid; the LAST one is the next to post
// tray:    loose ideas, not on the grid
const blank = () => ({
  version: 1, items: {}, posted: [], pinned: [], planned: [], tray: [],
  settings: { ratio: '3:4', fade: 0, clean: false, username: '' },
});
let state = blank();
let undoStack = [];
let redoStack = [];

// crypto.randomUUID only exists in secure contexts (not file:// or a LAN IP over http).
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const without = (list, id) => list.filter((x) => x !== id);

// Photos live as Blobs in IndexedDB; <img> tags get object URLs created once per session.
const mediaURLs = new Map();
const mediaURL = (file) => mediaURLs.get(file) || '';
async function storeBlob(blob) {
  const id = uid();
  await DB.put('media', id, blob);
  mediaURLs.set(id, URL.createObjectURL(blob));
  return id;
}
async function dropMedia(ids) {
  for (const id of ids) {
    URL.revokeObjectURL(mediaURLs.get(id));
    mediaURLs.delete(id);
  }
  await Promise.all(ids.map((id) => DB.del('media', id)));
}
async function loadMedia(ids) {
  await Promise.all(ids.filter((id) => id && !mediaURLs.has(id)).map(async (id) => {
    const blob = await DB.get('media', id);
    if (blob) mediaURLs.set(id, URL.createObjectURL(blob));
  }));
}

function save() {
  DB.put('kv', 'state', JSON.stringify(state)).catch((e) => toast(`Save failed: ${e.message}`));
}
function checkpoint(snapshot = JSON.stringify(state)) {
  undoStack.push(snapshot);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function change(mutate) {
  checkpoint();
  mutate();
  save();
  render();
}
function travel(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(state));
  state = JSON.parse(from.pop());
  save();
  render();
}
const undo = () => travel(undoStack, redoStack);
const redo = () => travel(redoStack, undoStack);

// ---------- rendering ----------
const ICONS = {
  carousel: '<path d="M7 3h11a3 3 0 0 1 3 3v11h-2V6a1 1 0 0 0-1-1H7z"/><rect x="3" y="7" width="14" height="14" rx="2.5"/>',
  video: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5z"/>',
  pin: '<path d="M15 3l6 6-2 1-3.5 3.5L16 18l-1.5 1.5-4-4L5 21l-1-1 5.5-5.5-4-4L7 9l4.5.5L15 6z"/>',
};
function icon(name) {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="currentColor">${ICONS[name]}</svg>`;
  return wrap.firstChild;
}

function tile(item, kind, order) {
  const el = document.createElement('div');
  el.className = `tile ${kind}`;
  el.dataset.id = item.id;

  if (item.file) {   // imported videos the browser can't decode have no thumbnail
    const img = new Image();
    img.src = mediaURL(item.file);
    img.draggable = false;
    img.decoding = 'async';
    el.append(img);
  }

  if (kind.includes('pinned')) el.append(icon('pin'));
  else if (item.count > 1) el.append(icon('carousel'));
  else if (item.video) el.append(icon('video'));

  if (kind.includes('posted')) {
    const date = item.ts ? new Date(item.ts * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
    el.title = [date, item.caption].filter(Boolean).join('\n');
  } else {
    el.draggable = true;
  }

  if (order) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = order;
    el.append(badge);
  }

  const actions = {
    planned: [['posted', '✓', 'I posted this'], ['unplan', '↩', 'Back to Ideas']],
    idea: [['plan', '＋', 'Add to top of grid'], ['delete', '✕', 'Delete idea']],
    posted: [['pin', '⌖', item && state.pinned.includes(item.id) ? 'Unpin' : 'Pin to top'], ['remove', '✕', 'Remove from grid']],
  }[kind.split(' ')[0]];
  const bar = document.createElement('div');
  bar.className = 'actions';
  for (const [act, label, title] of actions) {
    const b = document.createElement('button');
    Object.assign(b, { textContent: label, title });
    b.dataset.act = act;
    bar.append(b);
  }
  el.append(bar);
  return el;
}

function render() {
  const { items, settings } = state;
  const root = document.documentElement.style;
  root.setProperty('--ratio', settings.ratio === '1:1' ? '1 / 1' : '3 / 4');
  root.setProperty('--posted-opacity', 1 - settings.fade / 100);
  document.body.classList.toggle('clean', settings.clean);
  document.querySelectorAll('#ratio button').forEach((b) => b.classList.toggle('on', b.dataset.ratio === settings.ratio));
  $('#fade').value = settings.fade;
  $('#clean').checked = settings.clean;
  if (document.activeElement !== $('#username')) $('#username').value = settings.username;
  $('#avatar').textContent = (settings.username[0] || '✦').toUpperCase();

  const pinned = state.pinned.filter((id) => items[id]);
  const rest = state.posted.filter((id) => !pinned.includes(id));
  const n = state.planned.length;
  grid.replaceChildren(
    ...pinned.map((id) => tile(items[id], 'posted pinned')),
    ...state.planned.map((id, i) => tile(items[id], 'planned', n - i)),
    ...rest.map((id) => tile(items[id], 'posted')),
  );
  tray.replaceChildren(...state.tray.map((id) => tile(items[id], 'idea')));

  $('#postCount').textContent = state.posted.length + n;
  $('#plannedCount').textContent = n ? `· ${n} planned` : '';
  $('#empty').hidden = state.posted.length > 0;
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}

// ---------- tile buttons ----------
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-act]');
  if (!button) return;
  const id = button.closest('.tile').dataset.id;
  switch (button.dataset.act) {
    case 'posted':
      change(() => {
        state.planned = without(state.planned, id);
        state.posted.unshift(id);
        state.items[id].ts = Date.now() / 1000;
      });
      break;
    case 'unplan':
      change(() => { state.planned = without(state.planned, id); state.tray.unshift(id); });
      break;
    case 'plan':
      change(() => { state.tray = without(state.tray, id); state.planned.unshift(id); });
      break;
    case 'delete':
      change(() => { state.tray = without(state.tray, id); delete state.items[id]; });
      break;
    case 'pin':
      if (!state.pinned.includes(id) && state.pinned.length >= 3) return toast('Instagram allows up to 3 pinned posts');
      change(() => {
        state.pinned = state.pinned.includes(id) ? without(state.pinned, id) : [id, ...state.pinned];
      });
      break;
    case 'remove':
      if (!confirm('Remove this post from your grid preview? (It stays on Instagram.)')) return;
      change(() => {
        state.posted = without(state.posted, id);
        state.pinned = without(state.pinned, id);
        delete state.items[id];
      });
      break;
  }
});

// ---------- drag & drop ----------
// While dragging we move the real DOM node around (so the grid reflows live), then read the
// final order back out of the DOM on drop. Re-rendering mid-drag would destroy the dragged node.
let dragNode = null;
let dragSnapshot = null;
let fileDepth = 0;
const ghost = Object.assign(document.createElement('div'), { className: 'tile ghost' });
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

document.addEventListener('dragstart', (e) => {
  const t = e.target.closest?.('.tile[draggable="true"]');
  if (!t) return;
  dragNode = t;
  dragSnapshot = JSON.stringify(state);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', t.dataset.id);
  document.body.classList.add('dragging-any');
  requestAnimationFrame(() => t.classList.add('dragging'));   // after the drag image is captured
});

document.addEventListener('dragend', () => {
  if (!dragNode) return;
  dragNode.classList.remove('dragging');
  dragNode = null;
  document.body.classList.remove('dragging-any');
  commitDomOrder();
});

function commitDomOrder() {
  const ids = (zone) => [...zone.querySelectorAll('.tile:not(.posted):not(.ghost)')].map((t) => t.dataset.id);
  const planned = ids(grid);
  const trayIds = ids(tray);
  if (planned.join() !== state.planned.join() || trayIds.join() !== state.tray.join()) {
    checkpoint(dragSnapshot);
    state.planned = planned;
    state.tray = trayIds;
    save();
  }
  render();
}

/** Swap-style placement: moving forward lands after the hovered tile, moving backward lands before it. */
function insertRelative(node, over) {
  const sameParent = node.parentNode === over.parentNode;
  const after = sameParent && node.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING;
  over.parentNode.insertBefore(node, after ? over.nextSibling : over);
}

function place(zone, node, over) {
  if (over === node) return;
  if (zone === tray) {
    if (over) insertRelative(node, over);
    else if (node.parentNode !== tray) tray.append(node);
    return;
  }
  // On the grid, planned tiles always sit between the pinned posts and the rest of the posted grid.
  if (over && !over.classList.contains('posted')) return insertRelative(node, over);
  if (over?.classList.contains('pinned')) {
    const firstAfterPins = [...grid.children].find((c) => c !== node && !c.classList.contains('pinned'));
    return grid.insertBefore(node, firstAfterPins ?? null);
  }
  if (over || node.parentNode !== grid) grid.insertBefore(node, grid.querySelector('.tile.posted:not(.pinned)'));
}

for (const zone of [grid, tray]) {
  zone.addEventListener('dragover', (e) => {
    const node = dragNode || (isFileDrag(e) ? ghost : null);
    if (!node) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragNode ? 'move' : 'copy';
    place(zone, node, e.target.closest('.tile'));
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragNode && isFileDrag(e)) dropFiles(e);
  });
}

// Photos dragged in from Finder: show a ghost tile while hovering, clean it up if they leave the window.
document.addEventListener('dragenter', (e) => {
  if (dragNode || !isFileDrag(e)) return;
  fileDepth++;
  document.body.classList.add('file-drag');
});
document.addEventListener('dragleave', (e) => {
  if (!dragNode && isFileDrag(e) && --fileDepth <= 0) endFileDrag();
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {   // dropped outside a zone → goes to the front of Ideas
  e.preventDefault();
  if (!dragNode && isFileDrag(e)) { ghost.remove(); dropFiles(e); }
});
function endFileDrag() {
  fileDepth = 0;
  ghost.remove();
  document.body.classList.remove('file-drag');
}

function dropFiles(e) {
  const zip = [...e.dataTransfer.files].find((f) => /\.zip$/i.test(f.name));
  if (zip) { endFileDrag(); return openZip(zip); }
  const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  const onGrid = ghost.parentNode === grid;
  const zone = onGrid ? grid : tray;
  const index = Math.max(0, [...zone.querySelectorAll('.tile:not(.posted)')].indexOf(ghost));
  endFileDrag();
  addFiles(files, onGrid ? 'planned' : 'tray', index);
}

/** Downscale so 40 MB camera originals don't bloat browser storage; 1440px is Instagram's max width. */
async function downscale(file, max = 1440) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.9));
}

async function addFiles(files, list = 'tray', index = 0) {
  if (!files.length) return;
  const before = JSON.stringify(state);
  toast(`Adding ${files.length} photo${files.length > 1 ? 's' : ''}…`, true);
  const ids = [];
  for (const f of files) {
    try {
      const file = await storeBlob(await downscale(f));
      const id = uid();
      state.items[id] = { id, file };
      ids.push(id);
    } catch (err) {
      console.error(err);
      toast(`Couldn't read ${f.name}`);
    }
  }
  if (!ids.length) return;
  checkpoint(before);
  state[list].splice(index, 0, ...ids);
  save();
  render();
  toast(`Added ${ids.length} photo${ids.length > 1 ? 's' : ''}`);
}

// ---------- Instagram export & backups ----------
let busy = false;

/** A dropped/picked zip is either a Jigsta backup or an Instagram export. */
async function openZip(file) {
  try {
    const zip = await Zip.read(file);
    if (zip.names.includes('jigsta.json')) return restoreBackup(zip);
    await importExport(zip);
  } catch (e) {
    console.error(e);
    toast(e.message);
  }
}

async function importExport(source) {
  if (busy) return toast('Still importing the previous export…');
  busy = true;
  const before = JSON.stringify(state);
  // Photos are written as they're read but only referenced once the import finishes; track them so a
  // failure can delete them instead of leaving orphans that a retry would duplicate.
  const stored = [];
  const store = async (blob) => {
    // Export photos are usually already ≤1440px, where re-encoding can grow them; keep whichever is smaller.
    const small = await downscale(blob).catch(() => null);
    const id = await storeBlob(small && small.size < blob.size ? small : blob);
    stored.push(id);
    return id;
  };
  try {
    const known = Object.values(state.items).map((i) => i.key).filter(Boolean);
    const posts = await importInstagram(source, known, store, (i, n) => toast(`Importing ${i} / ${n}…`, true));
    if (!posts.length) return toast('No new posts found in that export');
    checkpoint(before);
    for (const p of posts) {
      const id = uid();
      state.items[id] = { id, ...p };
      state.posted.push(id);
    }
    state.posted.sort((a, b) => (state.items[b].ts || 0) - (state.items[a].ts || 0));
    stored.length = 0;   // the grid owns them now
    save();
    render();
    toast(`Imported ${posts.length} posts`);
  } catch (e) {
    console.error(e);
    toast(e.message);
    await dropMedia(stored).catch(console.error);
  } finally {
    busy = false;
  }
}

async function backup() {
  toast('Packing backup…', true);
  const files = [];
  const types = {};
  for (const id of await DB.keys('media')) {
    const blob = await DB.get('media', id);
    types[id] = blob.type;
    files.push({ name: `media/${id}`, blob });
  }
  files.unshift({ name: 'jigsta.json', blob: new Blob([JSON.stringify({ state, types })]) });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await Zip.write(files));
  a.download = `jigsta-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  toast(`Backed up ${files.length - 1} photos`);
}

async function restoreBackup(zip) {
  if (!confirm('Replace everything in Jigsta with this backup?')) return;
  toast('Restoring…', true);
  const { state: saved, types } = JSON.parse(await (await zip.blob('jigsta.json')).text());
  await DB.clear('media');
  mediaURLs.forEach((url) => URL.revokeObjectURL(url));
  mediaURLs.clear();
  for (const name of zip.names.filter((n) => n.startsWith('media/'))) {
    const id = name.slice(6);
    await DB.put('media', id, await zip.blob(name, types[id] || ''));
  }
  state = { ...blank(), ...saved, settings: { ...blank().settings, ...saved.settings } };
  undoStack = [];
  redoStack = [];
  await loadMedia(Object.values(state.items).map((i) => i.file));
  save();
  render();
  toast('Backup restored');
}

// ---------- controls ----------
let toastTimer;
function toast(message, sticky = false) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

$('#import').onclick = () => $('#zipInput').click();
$('#zipInput').onchange = (e) => { if (e.target.files[0]) openZip(e.target.files[0]); e.target.value = ''; };
$('#importFolder').onclick = (e) => { e.preventDefault(); $('#folderInput').click(); };
$('#folderInput').onchange = (e) => { if (e.target.files.length) importExport(folderSource(e.target.files)); e.target.value = ''; };
$('#backup').onclick = () => backup().catch((err) => toast(err.message));
$('#restore').onclick = () => $('#restoreInput').click();
$('#restoreInput').onchange = (e) => { if (e.target.files[0]) openZip(e.target.files[0]); e.target.value = ''; };
$('#undo').onclick = undo;
$('#redo').onclick = redo;
$('#add').onclick = () => $('#file').click();
$('#file').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('#ratio').onclick = (e) => {
  const r = e.target.dataset.ratio;
  if (r && r !== state.settings.ratio) change(() => { state.settings.ratio = r; });
};
$('#fade').oninput = (e) => {
  state.settings.fade = Number(e.target.value);
  document.documentElement.style.setProperty('--posted-opacity', 1 - state.settings.fade / 100);
};
$('#fade').onchange = save;
$('#clean').onchange = (e) => { state.settings.clean = e.target.checked; save(); render(); };
$('#username').oninput = (e) => {
  state.settings.username = e.target.value.trim();
  $('#avatar').textContent = (state.settings.username[0] || '✦').toUpperCase();
  save();
};
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input') || !e.metaKey || e.key.toLowerCase() !== 'z') return;
  e.preventDefault();
  e.shiftKey ? redo() : undo();
});

(async function init() {
  try {
    const raw = await DB.get('kv', 'state');
    if (raw) {
      const saved = JSON.parse(raw);
      state = { ...blank(), ...saved, settings: { ...blank().settings, ...saved.settings } };
      // Deleted tiles keep their photo until the next visit so undo can bring them back.
      const keep = new Set(Object.values(state.items).map((i) => i.file));
      for (const id of await DB.keys('media')) if (!keep.has(id)) DB.del('media', id);
      await loadMedia([...keep]);
    }
  } catch (e) {
    toast(`Couldn't load your saved grid: ${e.message}`);
  }
  navigator.storage?.persist?.();   // ask the browser not to evict our photos under storage pressure
  render();
})();
