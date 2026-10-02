/**
 * Stored uploads: the one place that writes them (F-11).
 *
 * Every image the server keeps went through images.js first (processImageUpload): storeImage()
 * refuses anything else, so no upload route can write the client's bytes by mistake. A file gets
 * a random 160-bit name and the extension of its detected format.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isProcessedImage } from './images.js';

/** Public uploads, served under /storage (app.js; in the container setup by Apache too). */
export const PUBLIC_ROOT = path.resolve(process.cwd(), 'storage');

/** The folders uploads go to (the first part of every stored path, e.g. 'avatars/<name>.jpg'). */
export const UPLOAD_FOLDERS = ['avatars', 'banners', 'evidence', 'posts', 'stories', 'user-banners'];

/** The absolute folder for one upload folder. */
function folderPath(folder) {
  if (!UPLOAD_FOLDERS.includes(folder)) throw new TypeError(`storeImage: unknown folder ${folder}`);
  return path.join(PUBLIC_ROOT, folder);
}

/**
 * Writes an image from processImageUpload() into `folder` and returns its stored path
 * ('<folder>/<40 hex>.<ext>'), the value that goes into the database.
 */
export async function storeImage(folder, image) {
  if (!isProcessedImage(image)) throw new TypeError('storeImage: only images from processImageUpload() are stored');
  const dir = folderPath(folder);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomBytes(20).toString('hex')}.${image.ext}`;
  // 'wx': never overwrite an existing file.
  await fs.writeFile(path.join(dir, name), image.buffer, { flag: 'wx' });
  return `${folder}/${name}`;
}
