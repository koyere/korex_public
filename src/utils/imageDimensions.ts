/**
 * Image dimensions read from its header, without decoding it.
 *
 * A compressed image of a few KB can declare 30,000 × 30,000 pixels
 * (≈3.6 GB once decoded). Remote user images are checked with this BEFORE
 * they are passed to canvas/loadImage (audit 2026-11-21, H·BOT2-01).
 */

export interface ImageDimensions { width: number; height: number; format: 'png' | 'jpeg' | 'gif' | 'webp' }

export const MAX_IMAGE_SIDE = 4096;
export const MAX_IMAGE_PIXELS = 4096 * 4096;

export function readImageDimensions(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null;
  // PNG: signature + IHDR chunk
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' };
  }
  // GIF: GIF87a / GIF89a
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), format: 'gif' };
  }
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP' && buf.length >= 30) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, format: 'webp' };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: 'webp' };
    }
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1, format: 'webp' };
    return null;
  }
  // JPEG: walk segments until an SOFn
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = buf.readUInt16BE(i + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), format: 'jpeg' };
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** true if the image has a known format and a size that is safe to decode. */
export function isSafeImageSize(buf: Buffer): boolean {
  const d = readImageDimensions(buf);
  if (!d || d.width <= 0 || d.height <= 0) return false;
  return d.width <= MAX_IMAGE_SIDE && d.height <= MAX_IMAGE_SIDE && d.width * d.height <= MAX_IMAGE_PIXELS;
}
