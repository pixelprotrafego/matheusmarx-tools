/**
 * Imagens para PDF, sem perder nada da imagem.
 *
 * - JPEG entra com os bytes originais (sem recomprimir). A rotação que o
 *   celular grava no EXIF é aplicada pela matriz do PDF, e não girando os
 *   pixels — que obrigaria a recomprimir. Sem isso, a foto saía deitada ou
 *   esticada: a prévia (que o navegador já gira) não batia com o PDF.
 * - PNG entra com a transparência preservada.
 * - O resto (WEBP, GIF, BMP, AVIF, HEIC) é decodificado pelo navegador e entra
 *   como PNG, sem perda em relação ao que foi decodificado.
 * - No tamanho "igual à imagem", a página tem o tamanho físico que a imagem
 *   declara (DPI): uma digitalização a 300 dpi vira uma página A4 de verdade.
 */

export type PageSize = "image" | "a4" | "letter";

export interface ImagesToPdfOptions {
  pageSize: PageSize;
  /** Margem em pontos (só nos tamanhos fixos). */
  margin: number;
  onProgress?: (done: number, total: number) => void;
}

export interface RasterInfo {
  width: number;
  height: number;
  /** Pontos por polegada declarados no arquivo, quando há. */
  dpiX: number | null;
  dpiY: number | null;
  /** Orientação EXIF (1 a 8), só no JPEG. */
  orientation: number;
}

const PAGE: Record<Exclude<PageSize, "image">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** DPI que vale quando o arquivo não declara (o do CSS: 1 px = 0,75 pt). */
const DEFAULT_DPI = 96;

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export function isJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export function isPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

/** Orientação e resolução de um bloco EXIF (TIFF dentro do APP1). */
function readExif(b: Uint8Array, start: number, end: number) {
  const out = { orientation: 1, dpiX: null as number | null, dpiY: null as number | null };
  if (end - start < 14) return out;
  const tiff = start + 6; // "Exif\0\0"
  const little = b[tiff] === 0x49;
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : u16be(b, o));
  const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : u32be(b, o));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return out;
  const count = u16(ifd);
  let xRes: number | null = null;
  let yRes: number | null = null;
  let unit = 2;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    const tag = u16(e);
    const valueAt = e + 8;
    if (tag === 0x0112) out.orientation = u16(valueAt);
    else if (tag === 0x0128) unit = u16(valueAt);
    else if (tag === 0x011a || tag === 0x011b) {
      const at = tiff + u32(valueAt);
      if (at + 8 <= end) {
        const den = u32(at + 4);
        const v = den ? u32(at) / den : 0;
        if (tag === 0x011a) xRes = v;
        else yRes = v;
      }
    }
  }
  const factor = unit === 3 ? 2.54 : unit === 2 ? 1 : 0;
  if (factor && xRes) out.dpiX = xRes * factor;
  if (factor && yRes) out.dpiY = yRes * factor;
  if (out.orientation < 1 || out.orientation > 8) out.orientation = 1;
  return out;
}

/** Tamanho, resolução e orientação de um JPEG, lendo só os cabeçalhos. */
export function readJpegInfo(b: Uint8Array): RasterInfo | null {
  if (!isJpeg(b)) return null;
  let o = 2;
  let width = 0;
  let height = 0;
  let orientation = 1;
  let jfif: { x: number; y: number } | null = null;
  let exif: { x: number | null; y: number | null } | null = null;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xff) {
      o += marker === 0xff ? 1 : 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const len = u16be(b, o + 2);
    const start = o + 4;
    const end = Math.min(b.length, o + 2 + len);
    if (marker === 0xe0 && end - start >= 12 && String.fromCharCode(...b.subarray(start, start + 4)) === "JFIF") {
      const units = b[start + 7];
      const x = u16be(b, start + 8);
      const y = u16be(b, start + 10);
      if (units === 1 && x && y) jfif = { x, y };
      else if (units === 2 && x && y) jfif = { x: x * 2.54, y: y * 2.54 };
    } else if (marker === 0xe1 && end - start >= 6 && String.fromCharCode(...b.subarray(start, start + 4)) === "Exif") {
      const e = readExif(b, start, end);
      orientation = e.orientation;
      exif = { x: e.dpiX, y: e.dpiY };
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = u16be(b, start + 1);
      width = u16be(b, start + 3);
    }
    o = o + 2 + len;
  }
  if (!width || !height) return null;
  return {
    width,
    height,
    dpiX: jfif?.x ?? exif?.x ?? null,
    dpiY: jfif?.y ?? exif?.y ?? null,
    orientation,
  };
}

/** Tamanho e resolução (chunk pHYs) de um PNG. */
export function readPngInfo(b: Uint8Array): RasterInfo | null {
  if (!isPng(b) || b.length < 24) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  let dpiX: number | null = null;
  let dpiY: number | null = null;
  let o = 8;
  while (o + 12 <= b.length) {
    const len = u32be(b, o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    if (type === "pHYs" && len >= 9 && b[o + 16] === 1) {
      dpiX = u32be(b, o + 8) * 0.0254;
      dpiY = u32be(b, o + 12) * 0.0254;
    }
    if (type === "IDAT" || type === "IEND") break;
    o += 12 + len;
  }
  return { width, height, dpiX, dpiY, orientation: 1 };
}

/** DPI utilizável: o declarado, se for plausível; senão, o padrão da tela. */
export function effectiveDpi(dpi: number | null): number {
  return dpi && dpi >= 50 && dpi <= 2400 ? dpi : DEFAULT_DPI;
}

/** Orientações 5 a 8 trocam largura e altura. */
export const swapsAxes = (orientation: number) => orientation >= 5 && orientation <= 8;

/**
 * Matriz do PDF que desenha a imagem guardada (quadrado unitário) na caixa
 * (x, y, w, h) já na orientação de exibição que o EXIF manda.
 */
export function orientationMatrix(orientation: number, x: number, y: number, w: number, h: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2: return [-w, 0, 0, h, x + w, y];
    case 3: return [-w, 0, 0, -h, x + w, y + h];
    case 4: return [w, 0, 0, -h, x, y + h];
    case 5: return [0, -h, -w, 0, x + w, y + h];
    case 6: return [0, -h, w, 0, x, y + h];
    case 7: return [0, h, w, 0, x, y];
    case 8: return [0, h, -w, 0, x + w, y];
    default: return [w, 0, 0, h, x, y];
  }
}

/** Decodifica pelo navegador (com HEIC à parte) e devolve PNG. */
async function decodeToPng(file: File): Promise<Uint8Array> {
  let source: Blob = file;
  if (/\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)) {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/png" });
    source = Array.isArray(out) ? out[0] : out;
  }
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("decode");
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    throw new Error(`Não foi possível ler a imagem "${file.name}". O formato pode não ser suportado por este navegador.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imagesToPdf(files: File[], options: ImagesToPdfOptions): Promise<Uint8Array> {
  const lib = await import("@cantoo/pdf-lib");
  const doc = await lib.PDFDocument.create();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let bytes = new Uint8Array(await file.arrayBuffer());
    let info = readJpegInfo(bytes);
    let image: import("@cantoo/pdf-lib").PDFImage | null = null;
    if (info) {
      try {
        image = await doc.embedJpg(bytes);
      } catch {
        image = null;
      }
    }
    if (!image) {
      if (!isPng(bytes)) bytes = await decodeToPng(file);
      info = readPngInfo(bytes);
      try {
        image = await doc.embedPng(bytes);
      } catch {
        // PNG que o pdf-lib não lê (entrelaçado raro, por exemplo): o navegador lê.
        bytes = await decodeToPng(file);
        info = readPngInfo(bytes);
        image = await doc.embedPng(bytes);
      }
    }
    if (!info) throw new Error(`Não foi possível ler a imagem "${file.name}".`);

    const swap = swapsAxes(info.orientation);
    const pixelW = swap ? info.height : info.width;
    const pixelH = swap ? info.width : info.height;
    const dpiW = effectiveDpi(swap ? info.dpiY : info.dpiX);
    const dpiH = effectiveDpi(swap ? info.dpiX : info.dpiY);
    const naturalW = (pixelW / dpiW) * 72;
    const naturalH = (pixelH / dpiH) * 72;

    let pageW: number;
    let pageH: number;
    let drawW: number;
    let drawH: number;
    if (options.pageSize === "image") {
      pageW = drawW = naturalW;
      pageH = drawH = naturalH;
    } else {
      const [a, b] = PAGE[options.pageSize];
      // Orientação da página acompanha a da imagem.
      [pageW, pageH] = naturalW > naturalH ? [b, a] : [a, b];
      const boxW = Math.max(1, pageW - 2 * options.margin);
      const boxH = Math.max(1, pageH - 2 * options.margin);
      const scale = Math.min(boxW / naturalW, boxH / naturalH);
      drawW = naturalW * scale;
      drawH = naturalH * scale;
    }
    const page = doc.addPage([pageW, pageH]);
    const x = (pageW - drawW) / 2;
    const y = (pageH - drawH) / 2;
    const name = page.node.newXObject("Image", image.ref);
    page.pushOperators(
      lib.pushGraphicsState(),
      lib.concatTransformationMatrix(...orientationMatrix(info.orientation, x, y, drawW, drawH)),
      lib.drawObject(name),
      lib.popGraphicsState(),
    );
    options.onProgress?.(i + 1, files.length);
  }
  return doc.save();
}
