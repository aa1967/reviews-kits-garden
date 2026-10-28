import { Jimp } from 'jimp';

export const AVATAR_UPLOAD_LIMIT = 2 * 1024 * 1024;
export function avatarDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length > AVATAR_UPLOAD_LIMIT) throw new Error('Choose a picture smaller than 2 MB.');
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      if (offset + 3 > bytes.length) break;
      const marker = bytes[offset++]!;
      if (marker === 0xda || marker === 0xd9) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) {
        return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  throw new Error('Choose a valid PNG or JPEG picture.');
}
let processing = 0;
export async function normalizeAvatar(bytes: Buffer): Promise<string> {
  const { width, height } = avatarDimensions(bytes);
  if (width < 1 || height < 1 || width > 2048 || height > 2048) throw new Error('Choose a picture up to 2048 × 2048 pixels. The upload picker resizes larger pictures automatically.');
  if (processing >= 2) throw new Error('Picture processing is busy. Try again in a moment.');
  processing++;
  try {
    const image = await Jimp.read(bytes);
    if (image.bitmap.width !== width || image.bitmap.height !== height) throw new Error('Invalid image dimensions.');
    image.cover({ w: 128, h: 128 });
    // Re-encoding drops EXIF and other uploaded metadata, including location.
    const png = await image.getBuffer('image/png');
    const encoded = png.toString('base64');
    if (encoded.length > 100000) throw new Error('The processed picture is too large.');
    return encoded;
  } catch {
    throw new Error('Could not read this picture. Choose another PNG or JPEG.');
  } finally { processing--; }
}
