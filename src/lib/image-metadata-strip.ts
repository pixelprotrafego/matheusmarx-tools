/**
 * Remoção de metadados sem recodificar a imagem.
 *
 * Redesenhar a foto num canvas (o que a ferramenta fazia) tira os metadados,
 * mas recomprime o JPEG (perde qualidade a cada passada), descarta o perfil de
 * cor (a foto de celular em Display P3 muda de cor) e, quando a orientação
 * estava só no EXIF, deixa a foto deitada em quem lê os bytes. Aqui o arquivo
 * é reescrito sem os blocos de metadados, com os pixels intactos, e mantém só
 * o que muda a aparência: perfil de cor, bloco Adobe (cores do CMYK) e a
 * orientação, num EXIF mínimo sem câmera, GPS nem data.
 */

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Orientação gravada num bloco EXIF (TIFF), ou 1. */
export function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 14) return 1;
  const little = tiff[0] === 0x49;
  const u16 = (o: number) => (little ? tiff[o] | (tiff[o + 1] << 8) : u16be(tiff, o));
  const u32 = (o: number) => (little ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)) >>> 0 : u32be(tiff, o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > tiff.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** TIFF mínimo (big-endian) só com a orientação. */
export function minimalExifTiff(orientation: number): Uint8Array {
  return Uint8Array.from([
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, // cabeçalho, IFD em 8
    0, 1, // uma entrada
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, // Orientation, SHORT, 1
    0, 0, 0, 0, // sem próximo IFD
  ]);
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

/** JPEG sem EXIF, XMP, IPTC, comentários e miniaturas; pixels intactos. */
export function stripJpeg(b: Uint8Array): Uint8Array {
  if (!(b[0] === 0xff && b[1] === 0xd8)) throw new Error("JPEG inválido");
  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let orientation = 1;
  let o = 2;
  let insertAt = 1; // depois do APP0 JFIF, se houver
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) throw new Error("JPEG inválido");
    const marker = b[o + 1];
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xda) {
      // Início dos dados da imagem: o resto vai como está.
      parts.push(b.subarray(o));
      break;
    }
    const len = u16be(b, o + 2);
    const seg = b.subarray(o, o + 2 + len);
    const body = b.subarray(o + 4, o + 2 + len);
    const sig = String.fromCharCode(...body.subarray(0, Math.min(14, body.length)));
    let keep: boolean;
    if (marker === 0xe1 && sig.startsWith("Exif")) {
      orientation = exifOrientation(body.subarray(6));
      keep = false;
    } else if (marker === 0xe0) keep = sig.startsWith("JFIF"); // JFXX (miniatura) sai
    else if (marker === 0xe2) keep = sig.startsWith("ICC_PROFILE"); // perfil de cor fica
    else if (marker === 0xee) keep = sig.startsWith("Adobe"); // transformação de cor do CMYK fica
    else if (marker >= 0xe0 && marker <= 0xef) keep = false; // XMP, IPTC/Photoshop, MPF, etc.
    else if (marker === 0xfe) keep = false; // comentário
    else keep = true; // tabelas, quadro, reinício: a imagem em si
    if (keep) {
      parts.push(seg);
      if (marker === 0xe0) insertAt = parts.length;
    }
    o += 2 + len;
  }
  if (orientation !== 1) {
    const payload = concat([Uint8Array.from(EXIF_HEADER), minimalExifTiff(orientation)]);
    const len = payload.length + 2;
    parts.splice(insertAt, 0, concat([Uint8Array.from([0xff, 0xe1, len >> 8, len & 255]), payload]));
  }
  return concat(parts);
}

/** PNG sem tEXt, zTXt, iTXt, eXIf e tIME; cor e resolução ficam. */
export function stripPng(b: Uint8Array): Uint8Array {
  if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) throw new Error("PNG inválido");
  const drop = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const end = o + 12 + len;
    if (!drop.has(type)) parts.push(b.subarray(o, end));
    o = end;
    if (type === "IEND") break;
  }
  return concat(parts);
}

/** WebP sem os blocos EXIF e XMP (e com as marcas do VP8X atualizadas). */
export function stripWebp(b: Uint8Array): Uint8Array {
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("WebP inválido");
  const chunks: Uint8Array[] = [];
  let vp8x: Uint8Array | null = null;
  let o = 12;
  while (o + 8 <= b.length) {
    const fourcc = tag(o);
    const size = b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24);
    const end = o + 8 + size + (size & 1);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const copy = b.slice(o, Math.min(end, b.length));
      if (fourcc === "VP8X") vp8x = copy;
      chunks.push(copy);
    }
    o = end;
  }
  // Bits de EXIF (0x08) e XMP (0x04) desligados no VP8X.
  if (vp8x) vp8x[8] &= ~(0x08 | 0x04);
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4));
  const riff = body.length + 4;
  header[4] = riff & 255;
  header[5] = (riff >> 8) & 255;
  header[6] = (riff >> 16) & 255;
  header[7] = (riff >>> 24) & 255;
  header.set(b.subarray(8, 12), 8);
  return concat([header, body]);
}
