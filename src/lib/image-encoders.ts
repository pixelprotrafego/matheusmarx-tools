/**
 * Codificadores de imagem que o navegador não tem.
 *
 * O `canvas.toBlob` dos navegadores só grava PNG, JPEG e (quase sempre) WEBP.
 * Pedido de BMP, GIF ou ICO saía como PNG com a extensão trocada — um arquivo
 * que muitos programas recusam. Aqui cada formato é gravado de verdade.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes por pixel, linha a linha de cima para baixo. */
  data: Uint8ClampedArray | Uint8Array;
}

// ------------------------------------------------------------------- BMP

/** BMP de 24 bits (sem transparência: o chamador compõe o fundo antes). */
export function encodeBmp(img: Pixels): Uint8Array {
  const { width: w, height: h, data } = img;
  const rowSize = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + rowSize * h;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true);
  v.setInt32(22, h, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * rowSize;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = row + x * 3;
      out[d] = data[s + 2];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s];
    }
  }
  return out;
}

// ------------------------------------------------------------------- GIF

interface Quantized {
  palette: number[][]; // [r, g, b]
  indices: Uint8Array;
  transparent: number | null;
}

/**
 * Até 256 cores, sem perda; acima disso, corte pela mediana com pontilhado
 * Floyd–Steinberg (o degradê vira pontos, não faixas). Pixel com menos de
 * metade de opacidade vira transparente.
 */
export function quantize(img: Pixels): Quantized {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const indices = new Uint8Array(n);
  let hasTransparent = false;
  const exact = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) {
      hasTransparent = true;
      continue;
    }
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    if (!exact.has(key)) {
      exact.set(key, exact.size);
      if (exact.size > 256) break;
    }
  }
  const maxColors = hasTransparent ? 255 : 256;
  if (exact.size <= maxColors) {
    const palette = [...exact.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    const transparent = hasTransparent ? palette.length : null;
    if (hasTransparent) palette.push([0, 0, 0]);
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] < 128) indices[i] = transparent!;
      else indices[i] = exact.get((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2])!;
    }
    return { palette, indices, transparent };
  }

  // Histograma em 5 bits por canal.
  const hist = new Uint32Array(32768);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue;
    hist[((data[i * 4] >> 3) << 10) | ((data[i * 4 + 1] >> 3) << 5) | (data[i * 4 + 2] >> 3)]++;
  }
  const colors: number[] = [];
  for (let c = 0; c < 32768; c++) if (hist[c]) colors.push(c);
  type Box = { cs: number[]; count: number };
  const channel = (c: number, k: number) => (k === 0 ? c >> 10 : k === 1 ? (c >> 5) & 31 : c & 31);
  const range = (box: Box) => {
    let best = 0;
    let axis = 0;
    for (let k = 0; k < 3; k++) {
      let lo = 31;
      let hi = 0;
      for (const c of box.cs) {
        const v = channel(c, k);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        axis = k;
      }
    }
    return { best, axis };
  };
  const boxes: Box[] = [{ cs: colors, count: colors.reduce((s, c) => s + hist[c], 0) }];
  while (boxes.length < maxColors) {
    let pick = -1;
    let score = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].cs.length < 2) continue;
      const s = range(boxes[i]).best * Math.sqrt(boxes[i].count);
      if (s > score) {
        score = s;
        pick = i;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    const { axis } = range(box);
    box.cs.sort((a, b) => channel(a, axis) - channel(b, axis));
    let acc = 0;
    let cut = 0;
    for (; cut < box.cs.length - 1; cut++) {
      acc += hist[box.cs[cut]];
      if (acc >= box.count / 2) break;
    }
    const left = box.cs.slice(0, cut + 1);
    const right = box.cs.slice(cut + 1);
    boxes.splice(pick, 1, { cs: left, count: left.reduce((s, c) => s + hist[c], 0) }, { cs: right, count: right.reduce((s, c) => s + hist[c], 0) });
  }
  const palette = boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const c of box.cs) {
      const k = hist[c];
      r += ((c >> 10) * 8 + 4) * k;
      g += (((c >> 5) & 31) * 8 + 4) * k;
      b += ((c & 31) * 8 + 4) * k;
    }
    return [Math.round(r / box.count), Math.round(g / box.count), Math.round(b / box.count)];
  });
  const transparent = hasTransparent ? palette.length : null;
  if (hasTransparent) palette.push([0, 0, 0]);
  const solid = hasTransparent ? palette.length - 1 : palette.length;

  const cache = new Map<number, number>();
  const nearest = (r: number, g: number, b: number) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < solid; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 * 2 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 3;
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };
  // Pontilhado Floyd–Steinberg, com o erro em ponto flutuante.
  const err = new Float32Array(n * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i * 4 + 3] < 128) {
        indices[i] = transparent!;
        continue;
      }
      const r = Math.min(255, Math.max(0, data[i * 4] + err[i * 3]));
      const g = Math.min(255, Math.max(0, data[i * 4 + 1] + err[i * 3 + 1]));
      const b = Math.min(255, Math.max(0, data[i * 4 + 2] + err[i * 3 + 2]));
      const idx = nearest(r | 0, g | 0, b | 0);
      indices[i] = idx;
      const p = palette[idx];
      const er = r - p[0];
      const eg = g - p[1];
      const eb = b - p[2];
      const spread = (j: number, f: number) => {
        err[j * 3] += er * f;
        err[j * 3 + 1] += eg * f;
        err[j * 3 + 2] += eb * f;
      };
      if (x + 1 < w) spread(i + 1, 7 / 16);
      if (y + 1 < h) {
        if (x > 0) spread(i + w - 1, 3 / 16);
        spread(i + w, 5 / 16);
        if (x + 1 < w) spread(i + w + 1, 1 / 16);
      }
    }
  }
  return { palette, indices, transparent };
}

/** Compressão LZW do GIF (mesma sequência de códigos do omggif). */
function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  let codeSize = minCodeSize + 1;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let next = eoi + 1;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let cur = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (cur << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) {
      cur = hit;
      continue;
    }
    emit(cur);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1;
      codeSize = minCodeSize + 1;
      table = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    cur = k;
  }
  emit(cur);
  emit(eoi);
  if (bits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

/** GIF89a de um quadro. */
export function encodeGif(img: Pixels): Uint8Array {
  const { palette, indices, transparent } = quantize(img);
  let bitsPerColor = 1;
  while (1 << bitsPerColor < palette.length) bitsPerColor++;
  const tableSize = 1 << bitsPerColor;
  const minCodeSize = Math.max(2, bitsPerColor);
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 255, (v >> 8) & 255);
  out.push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
  u16(img.width);
  u16(img.height);
  out.push(0x80 | ((bitsPerColor - 1) << 4) | (bitsPerColor - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) out.push(...(palette[i] ?? [0, 0, 0]));
  if (transparent !== null) out.push(0x21, 0xf9, 4, 0x01, 0, 0, transparent, 0);
  out.push(0x2c);
  u16(0);
  u16(0);
  u16(img.width);
  u16(img.height);
  out.push(0, minCodeSize);
  const data = lzw(indices, minCodeSize);
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.subarray(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0, 0x3b);
  return Uint8Array.from(out);
}

// ------------------------------------------------------------------- ICO

/** Imagem num quadrado de `size`, centralizada e sem distorcer. */
export function fitSquare(source: CanvasImageSource & { width: number; height: number }, size: number): HTMLCanvasElement {
  // Reduções grandes em etapas de metade: uma redução direta de 1024 para 16
  // amostra poucos pixels e serrilha.
  let src: CanvasImageSource = source;
  let sw = source.width;
  let sh = source.height;
  while (Math.max(sw, sh) / 2 >= size) {
    const half = document.createElement("canvas");
    half.width = Math.max(1, Math.round(sw / 2));
    half.height = Math.max(1, Math.round(sh / 2));
    const hctx = half.getContext("2d")!;
    hctx.imageSmoothingQuality = "high";
    hctx.drawImage(src, 0, 0, half.width, half.height);
    src = half;
    sw = half.width;
    sh = half.height;
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const scale = size / Math.max(sw, sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  ctx.drawImage(src, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
  return canvas;
}

/** Imagem do ícone em DIB de 32 bits (BGRA + máscara), o formato clássico. */
function dib(img: Pixels): Uint8Array {
  const { width: w, height: h, data } = img;
  const maskRow = Math.ceil(w / 32) * 4;
  const out = new Uint8Array(40 + w * h * 4 + maskRow * h);
  const v = new DataView(out.buffer);
  v.setUint32(0, 40, true);
  v.setInt32(4, w, true);
  v.setInt32(8, h * 2, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, 32, true);
  v.setUint32(20, w * h * 4 + maskRow * h, true);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = 40 + ((h - 1 - y) * w + x) * 4;
      out[d] = data[s + 2];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s];
      out[d + 3] = data[s + 3];
    }
  }
  // Máscara AND toda zero: a transparência vem do canal alfa.
  return out;
}

export interface IcoEntry {
  size: number;
  pixels: Pixels;
  /** PNG já codificado (usado nos tamanhos grandes). */
  png?: Uint8Array;
}

/** Arquivo .ico com vários tamanhos: DIB até 64 px, PNG acima (Windows Vista+). */
export function encodeIco(entries: IcoEntry[]): Uint8Array {
  const images = entries.map((e) => (e.size > 64 && e.png ? e.png : dib(e.pixels)));
  const header = 6 + 16 * entries.length;
  const total = header + images.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries.length, true);
  let offset = header;
  entries.forEach((e, i) => {
    const d = 6 + i * 16;
    out[d] = e.size >= 256 ? 0 : e.size;
    out[d + 1] = e.size >= 256 ? 0 : e.size;
    v.setUint16(d + 4, 1, true);
    v.setUint16(d + 6, 32, true);
    v.setUint32(d + 8, images[i].length, true);
    v.setUint32(d + 12, offset, true);
    out.set(images[i], offset);
    offset += images[i].length;
  });
  return out;
}

/** Tamanhos do .ico: os padrões do Windows, sem passar de 256. */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
