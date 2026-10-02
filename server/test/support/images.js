/**
 * Image fixtures for the server tests: small, structurally valid JPEG, PNG and WebP files, and
 * helpers that add metadata or a payload to them.
 *
 * The images are static bytes and the helpers use only Buffer and zlib (no image library), so a
 * test that imports this file also runs against a server without the upload pipeline.
 *
 * Why this file exists: the 1x1 PNG the upload tests used before was not a valid PNG (its IDAT
 * checksum did not match and the IEND chunk was cut off). Nothing decoded uploads then, so it went
 * through; a server that checks that an upload is a real image correctly refuses it.
 *
 * The metadata helpers write the marker METADATA_MARKER (and, for JPEG, a GPS position) into the
 * places where cameras and editors keep metadata: an EXIF block in JPEG (APP1) and WebP (EXIF
 * chunk), tEXt and eXIf chunks in PNG. A stored upload must contain none of it.
 */
import zlib from 'node:zlib';

/** Text that a test looks for in stored bytes; never part of an image's pixels. */
export const METADATA_MARKER = 'GOENN-EXIF-MARKER';

/** A valid 1x1 RGB PNG. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNQcFgAAAGEAQEqnkKLAAAAAElFTkSuQmCC',
  'base64',
);

/** A valid 8x8 baseline JPEG without metadata. */
export const JPEG_8X8 = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAYEAEBAAMAAAAAAAAAAAAAAAAABiMyof/EABUBAQEAAAAAAAAAAAAAAAAAAAEC/8QAHBEAAAYDAAAAAAAAAAAAAAAAAAEDBAUhAhMU/9oADAMBAAIRAxEAPwCs9Ka4+ABy+W2HYiDkV+TGx//Z',
  'base64',
);

/** A valid 8x4 (width x height) baseline JPEG without metadata, for the orientation test. */
export const JPEG_8X4 = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAYEAEAAwEAAAAAAAAAAAAAAAAABAUiBv/EABQBAQAAAAAAAAAAAAAAAAAAAAX/xAAbEQACAQUAAAAAAAAAAAAAAAAAAiEBBAUTFP/aAAwDAQACEQMRAD8Ag56ujZwAUuXbZWRfBu3Isn//2Q==',
  'base64',
);

/** A valid 8x8 lossy WebP (simple format, no metadata). */
export const WEBP_8X8 = Buffer.from(
  'UklGRkYAAABXRUJQVlA4IDoAAACwAQCdASoIAAgAAUAmJbACdAD0Ma2oAP7tD/tcPaAsIKWYrzDp86+8G1S0ff/8kz8Q/db/bP1AAAAA',
  'base64',
);

/** Text that claims to be an image: a declared image type is all it has. */
export const NOT_AN_IMAGE = Buffer.from('<html><body><script>/* not an image */</script></body></html>\n');

/**
 * The PNG the tests used before this file: right signature and header, but a wrong IDAT checksum
 * and a cut-off IEND chunk. Kept only to show that such bytes are refused.
 */
export const MALFORMED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

/* ------------------------------------------------------------------ EXIF (TIFF) */

const TIFF_ASCII = 2;
const TIFF_SHORT = 3;
const TIFF_LONG = 4;
const TIFF_RATIONAL = 5;

/**
 * A big-endian TIFF structure as EXIF uses it: IFD0 with ImageDescription = `marker`, an optional
 * Orientation, and a GPS IFD with a latitude and longitude. Offsets count from the TIFF header.
 */
export function exifTiff(marker = METADATA_MARKER, { orientation = null } = {}) {
  const description = Buffer.from(`${marker}\0`, 'latin1');
  const ifd0Entries = 1 + (orientation === null ? 0 : 1) + 1;
  const ifd0Size = 2 + ifd0Entries * 12 + 4;
  const gpsEntries = 4;
  const gpsSize = 2 + gpsEntries * 12 + 4;
  const ifd0Offset = 8;
  const gpsOffset = ifd0Offset + ifd0Size;
  const descriptionOffset = gpsOffset + gpsSize;
  const latitudeOffset = descriptionOffset + description.length + (description.length % 2);
  const longitudeOffset = latitudeOffset + 24;
  const total = longitudeOffset + 24;

  const tiff = Buffer.alloc(total);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(ifd0Offset, 4);

  const entry = (at, tag, type, count, value) => {
    tiff.writeUInt16BE(tag, at);
    tiff.writeUInt16BE(type, at + 2);
    tiff.writeUInt32BE(count, at + 4);
    if (Buffer.isBuffer(value)) value.copy(tiff, at + 8);
    else if (type === TIFF_SHORT) tiff.writeUInt16BE(value, at + 8);
    else tiff.writeUInt32BE(value, at + 8);
  };

  // IFD0, entries in tag order.
  let at = ifd0Offset;
  tiff.writeUInt16BE(ifd0Entries, at);
  at += 2;
  entry(at, 0x010e, TIFF_ASCII, description.length, descriptionOffset); // ImageDescription
  at += 12;
  if (orientation !== null) {
    entry(at, 0x0112, TIFF_SHORT, 1, orientation); // Orientation
    at += 12;
  }
  entry(at, 0x8825, TIFF_LONG, 1, gpsOffset); // GPSInfo
  at += 12;
  tiff.writeUInt32BE(0, at); // no next IFD

  // GPS IFD: an obviously made-up position.
  at = gpsOffset;
  tiff.writeUInt16BE(gpsEntries, at);
  at += 2;
  entry(at, 0x0001, TIFF_ASCII, 2, Buffer.from('N\0', 'latin1')); // GPSLatitudeRef
  at += 12;
  entry(at, 0x0002, TIFF_RATIONAL, 3, latitudeOffset); // GPSLatitude
  at += 12;
  entry(at, 0x0003, TIFF_ASCII, 2, Buffer.from('E\0', 'latin1')); // GPSLongitudeRef
  at += 12;
  entry(at, 0x0004, TIFF_RATIONAL, 3, longitudeOffset); // GPSLongitude
  at += 12;
  tiff.writeUInt32BE(0, at);

  description.copy(tiff, descriptionOffset);
  [12, 34, 56].forEach((n, i) => {
    tiff.writeUInt32BE(n, latitudeOffset + i * 8);
    tiff.writeUInt32BE(1, latitudeOffset + i * 8 + 4);
  });
  [65, 43, 21].forEach((n, i) => {
    tiff.writeUInt32BE(n, longitudeOffset + i * 8);
    tiff.writeUInt32BE(1, longitudeOffset + i * 8 + 4);
  });
  return tiff;
}

/** The EXIF identifier that starts an APP1 segment ("Exif\0\0"). */
export const EXIF_HEADER = Buffer.from('Exif\0\0', 'latin1');

/* ------------------------------------------------------------------ JPEG */

/** `jpeg` with an APP1 EXIF segment (marker, GPS, optional orientation) right after SOI. */
export function withJpegExif(jpeg, { marker = METADATA_MARKER, orientation = null } = {}) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('withJpegExif: not a JPEG');
  const payload = Buffer.concat([EXIF_HEADER, exifTiff(marker, { orientation })]);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xffe1, 0);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

/** Width and height from a JPEG's first SOF segment (baseline or progressive). */
export function jpegSize(jpeg) {
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) throw new Error('jpegSize: lost the segment chain');
    const marker = jpeg[at + 1];
    const length = jpeg.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  throw new Error('jpegSize: no SOF segment');
}

/* ------------------------------------------------------------------ PNG */

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** `png` with a tEXt chunk and an eXIf chunk (both carrying the marker) right after IHDR. */
export function withPngText(png, { marker = METADATA_MARKER } = {}) {
  const ihdrEnd = 8 + 8 + png.readUInt32BE(8) + 4;
  const text = pngChunk('tEXt', Buffer.from(`Comment\0${marker}`, 'latin1'));
  const exif = pngChunk('eXIf', exifTiff(marker));
  return Buffer.concat([png.subarray(0, ihdrEnd), text, exif, png.subarray(ihdrEnd)]);
}

/**
 * A valid PNG of any size that stays a few kilobytes as a file: 1-bit grayscale, every pixel black
 * (rows of zeros compress to almost nothing). For the decoded-size guard.
 */
export function pngOfSize(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc(height * (1 + Math.ceil(width / 8))); // filter byte 0 + pixels, all zero
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bytes appended after the image's end (after IEND, EOI or the RIFF container). */
export function withTrailer(image, trailer) {
  return Buffer.concat([image, Buffer.from(trailer, 'latin1')]);
}

/* ------------------------------------------------------------------ WebP */

/** Width and height of a simple-format WebP (VP8 or VP8L bitstream). */
function webpSize(webp) {
  const chunk = webp.toString('latin1', 12, 16);
  const data = 20;
  if (chunk === 'VP8 ') {
    return { width: webp.readUInt16LE(data + 6) & 0x3fff, height: webp.readUInt16LE(data + 8) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = webp.readUInt32LE(data + 1);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`withWebpExif: unexpected first chunk ${chunk}`);
}

/** `webp` (simple format) rewritten as an extended WebP (VP8X) with an EXIF chunk carrying the marker. */
export function withWebpExif(webp, { marker = METADATA_MARKER } = {}) {
  if (webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error('withWebpExif: not a WebP');
  }
  const { width, height } = webpSize(webp);
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08; // EXIF flag
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);

  const riffChunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 'latin1');
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };

  const body = Buffer.concat([
    Buffer.from('WEBP', 'latin1'),
    riffChunk('VP8X', vp8x),
    webp.subarray(12, 8 + webp.readUInt32LE(4)),
    riffChunk('EXIF', exifTiff(marker)),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/* ------------------------------------------------------------------ checks */

/** Does `bytes` contain any trace of the metadata the helpers above add? */
export function hasMetadataTrace(bytes, marker = METADATA_MARKER) {
  const buf = Buffer.from(bytes);
  return (
    buf.includes(Buffer.from(marker, 'latin1')) ||
    buf.includes(EXIF_HEADER) ||
    buf.includes(Buffer.from('eXIf', 'latin1')) ||
    buf.includes(Buffer.from('tEXt', 'latin1')) ||
    // The TIFF header of an EXIF block (big-endian, as written above).
    buf.includes(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  );
}
