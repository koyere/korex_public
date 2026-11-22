import { readImageDimensions, isSafeImageSize } from '../../src/utils/imageDimensions';

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function jpeg(w: number, h: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
}
function gif(w: number, h: number): Buffer {
  const b = Buffer.alloc(24); b.write('GIF89a', 0, 'ascii'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
}

// Regression H·BOT2-01: a background of a few KB declaring 30,000 × 30,000 px crashed the process
describe('imageDimensions', () => {
  it('reads PNG, JPEG and GIF', () => {
    expect(readImageDimensions(png(700, 250))).toMatchObject({ width: 700, height: 250, format: 'png' });
    expect(readImageDimensions(jpeg(1920, 1080))).toMatchObject({ width: 1920, height: 1080, format: 'jpeg' });
    expect(readImageDimensions(gif(320, 200))).toMatchObject({ width: 320, height: 200, format: 'gif' });
  });
  it('rejects oversized images', () => {
    expect(isSafeImageSize(png(30000, 30000))).toBe(false);
    expect(isSafeImageSize(jpeg(5000, 100))).toBe(false);
    expect(isSafeImageSize(png(1920, 1080))).toBe(true);
  });
  it('rechaza formatos desconocidos o truncados', () => {
    expect(isSafeImageSize(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(false);
    expect(isSafeImageSize(Buffer.alloc(10))).toBe(false);
  });
});
