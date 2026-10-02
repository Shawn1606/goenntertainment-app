/**
 * Stored uploads: the one place that writes, finds, serves and removes them (F-11).
 *
 * Every image the server keeps went through images.js first (processImageUpload): storeImage()
 * refuses anything else, so no upload route can write the client's bytes by mistake. A file gets
 * a random 160-bit name and the extension of its detected format.
 *
 * ## Two roots
 *
 * - PUBLIC_ROOT (`storage/`): avatars, profile banners, event banners and post images. Served to
 *   anyone under /storage (app.js; in the container setup by Apache too).
 * - PRIVATE_ROOT (`storage-private/`): ban and moderation evidence, and story images. Never under
 *   /storage and never mounted into a web server; Node serves them only through checked routes:
 *   evidence to admins (GET /api/admin/evidence-files/:file), a story image to signed-in viewers
 *   while the story runs and no block stands between viewer and author
 *   (GET /api/media/stories/:file).
 *
 * The database keeps the same values as before ('evidence/<name>', 'stories/<name>'): the folder,
 * the first part of the value, decides the root. So no row changes; files that an older version
 * wrote into the public tree are moved over once at start (migrateLegacyPrivateFiles).
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isProcessedImage } from './images.js';

/** Public uploads, served under /storage. */
export const PUBLIC_ROOT = path.resolve(process.cwd(), 'storage');

/** Private uploads, served only through the checked routes above. */
export const PRIVATE_ROOT = path.resolve(process.cwd(), 'storage-private');

/** The folders uploads go to (the first part of every stored path, e.g. 'avatars/<name>.jpg'). */
export const PUBLIC_FOLDERS = ['avatars', 'banners', 'posts', 'user-banners'];
export const PRIVATE_FOLDERS = ['evidence', 'stories'];
export const UPLOAD_FOLDERS = [...PUBLIC_FOLDERS, ...PRIVATE_FOLDERS];

/** A file name storeImage() gives: 40 hex characters and the extension of an accepted format. */
export const STORED_NAME = /^[0-9a-f]{40}\.(jpg|png|webp)$/;

/** The root a folder lives in, or null for an unknown folder. */
export function rootFor(folder) {
  if (PRIVATE_FOLDERS.includes(folder)) return PRIVATE_ROOT;
  if (PUBLIC_FOLDERS.includes(folder)) return PUBLIC_ROOT;
  return null;
}

/**
 * The absolute file for a stored value ('<folder>/<name>'), or null.
 *
 * The value comes from our own database, but a value that names an unknown folder or leaves its
 * folder (a '..' somewhere) gives null: otherwise a row could name any file of the server.
 */
export function resolveStored(value) {
  if (typeof value !== 'string' || value === '' || /^https?:\/\//i.test(value)) return null;
  const folder = value.split('/')[0];
  const root = rootFor(folder);
  if (!root) return null;
  const base = path.join(root, folder);
  const target = path.resolve(root, value);
  return target.startsWith(base + path.sep) ? target : null;
}

/** Removes a stored file, best effort: a file that is already gone is no error. Never throws. */
export async function removeStored(value) {
  const target = resolveStored(value);
  if (!target) return false;
  return fs.unlink(target).then(() => true, () => false);
}

/**
 * Writes an image from processImageUpload() into `folder` (under its root) and returns its stored
 * path ('<folder>/<40 hex>.<ext>'), the value that goes into the database.
 */
export async function storeImage(folder, image) {
  if (!isProcessedImage(image)) throw new TypeError('storeImage: only images from processImageUpload() are stored');
  const root = rootFor(folder);
  if (!root) throw new TypeError(`storeImage: unknown folder ${folder}`);
  const dir = path.join(root, folder);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomBytes(20).toString('hex')}.${image.ext}`;
  // 'wx': never overwrite an existing file.
  await fs.writeFile(path.join(dir, name), image.buffer, { flag: 'wx' });
  return `${folder}/${name}`;
}

/**
 * Headers of every stored file Node serves (public and private): the browser must take the type
 * as sent and never guess another one (nosniff), and a file opened on its own may run nothing
 * (the CSP; an image needs none of it).
 */
export function setStoredFileHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
}

/**
 * Sends a private file to a viewer the route has already checked, or 404 when there is none.
 * The response is not kept by any cache on the way or on the device ('private, no-store').
 */
export function sendPrivateFile(res, next, folder, name) {
  if (!PRIVATE_FOLDERS.includes(folder) || !STORED_NAME.test(String(name))) {
    return res.status(404).json({ message: 'Nicht gefunden.' });
  }
  setStoredFileHeaders(res);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.sendFile(
    name,
    { root: path.join(PRIVATE_ROOT, folder), dotfiles: 'deny', etag: false, lastModified: false },
    (err) => {
      if (!err) return;
      if (res.headersSent) return next(err);
      res.removeHeader('Cache-Control');
      if (err.code === 'ENOENT' || err.status === 404) return res.status(404).json({ message: 'Nicht gefunden.' });
      return next(err);
    },
  );
}

/**
 * Whether a request path under /storage names a private folder ('/evidence/...',
 * '/stories/...'), in any spelling: decoded until it no longer changes, backslashes as slashes,
 * dot segments resolved, any case. Such paths are never served from the public tree, even if an
 * old file is still there. A path that cannot be decoded counts as private (refused).
 */
export function isPrivateStoragePath(requestPath) {
  let value = String(requestPath ?? '');
  for (let i = 0; i < 5; i += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return true;
    }
    if (decoded === value) break;
    value = decoded;
  }
  const normalised = path.posix.normalize(`/${value.replaceAll('\\', '/')}`).toLowerCase();
  const first = normalised.split('/').filter(Boolean)[0] ?? '';
  return PRIVATE_FOLDERS.includes(first);
}

/**
 * Moves files that an older version wrote into the public tree (storage/evidence,
 * storage/stories) to the private root. Runs at every start (index.js) and does nothing once
 * they are moved. Only names storeImage() gives are moved; anything else stays where it is, and
 * the public route refuses those folders anyway (isPrivateStoragePath). Returns the number of
 * files moved.
 */
export async function migrateLegacyPrivateFiles() {
  let moved = 0;
  for (const folder of PRIVATE_FOLDERS) {
    const from = path.join(PUBLIC_ROOT, folder);
    let names;
    try {
      names = await fs.readdir(from);
    } catch (err) {
      if (err?.code === 'ENOENT') continue;
      throw err;
    }
    const legacy = names.filter((name) => STORED_NAME.test(name));
    if (legacy.length === 0) continue;
    const to = path.join(PRIVATE_ROOT, folder);
    await fs.mkdir(to, { recursive: true });
    for (const name of legacy) {
      const source = path.join(from, name);
      const target = path.join(to, name);
      try {
        await fs.rename(source, target);
      } catch (err) {
        // Another file system (the private folder is its own mount): copy, then remove.
        if (err?.code !== 'EXDEV') throw err;
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        await fs.unlink(source);
      }
      moved += 1;
    }
  }
  return moved;
}
