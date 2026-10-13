'use strict';
// Instagram "Download your information" (JSON format) → grid posts.
// A source is { names: [paths relative to the export root], blob(path, type) }, from a zip or a folder.

/** An unzipped export picked with <input webkitdirectory>; paths drop the picked folder's own name. */
function folderSource(fileList) {
  const files = new Map();
  for (const f of fileList) files.set(f.webkitRelativePath.split('/').slice(1).join('/'), f);
  return {
    names: [...files.keys()],
    blob: async (name, type) => (type ? new Blob([files.get(name)], { type }) : files.get(name)),
  };
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', gif: 'image/gif' };
const mimeFor = (path) => MIME[path.split('.').pop().toLowerCase()] || '';

/** Instagram writes UTF-8 bytes as Latin-1 escapes ("cafÃ©" for "café"); reinterpreting the bytes undoes it. */
function fixMojibake(s) {
  if ([...s].some((c) => c.charCodeAt(0) > 255)) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch {
    return s;
  }
}

function videoThumbnail(blob) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(blob);
    // Some browsers (Safari) never fire loadeddata/error for a detached <video>; without a deadline the import hangs.
    const timer = setTimeout(() => done(null), 8000);
    const done = (result) => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(result); };
    Object.assign(video, { muted: true, playsInline: true, preload: 'auto', src: url });
    video.onloadeddata = () => { video.currentTime = Math.min(0.5, (video.duration || 1) / 2); };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob(done, 'image/jpeg', 0.85);
    };
    video.onerror = () => done(null);   // codec the browser can't decode → plain placeholder tile
  });
}

/**
 * Grid posts live in posts_N.json; reels shared to the grid live in reels.json. Their folder moved
 * between export versions (content/, your_instagram_activity/content/, …/media/), so match by name.
 * storeBlob(blob) persists a photo and returns its media id. known = post URIs already imported.
 */
async function importInstagram(source, known, storeBlob, onProgress) {
  const postFiles = source.names.filter((n) => /(^|\/)(posts_\d+|reels)\.json$/.test(n));
  if (!postFiles.length) throw new Error('No posts_1.json found. Request the export in JSON format (the default is HTML).');

  const names = new Set(source.names);
  const resolve = (uri) => (names.has(uri) ? uri : source.names.find((n) => n.endsWith(`/${uri}`)));

  const entries = [];
  for (const path of postFiles) {
    const data = JSON.parse(await (await source.blob(path)).text());
    // posts_N.json is a top-level array; reels.json wraps it in {"ig_reels_media": [...]}.
    entries.push(...(Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || []));
  }

  const seen = new Set(known);
  const posts = [];
  for (const [i, entry] of entries.entries()) {
    onProgress?.(i + 1, entries.length);
    const first = entry.media?.[0];
    const uri = first?.uri;
    const path = uri && !seen.has(uri) && resolve(uri);
    if (!path) continue;
    seen.add(uri);

    const video = /\.(mp4|mov)$/i.test(path);
    const blob = video ? await videoThumbnail(await source.blob(path, 'video/mp4')) : await source.blob(path, mimeFor(path));
    posts.push({
      key: uri,
      file: blob ? await storeBlob(blob) : null,
      ts: entry.creation_timestamp ?? first.creation_timestamp ?? 0,
      caption: fixMojibake(entry.title || first.title || ''),
      count: entry.media.length,
      video,
    });
  }
  return posts;
}
