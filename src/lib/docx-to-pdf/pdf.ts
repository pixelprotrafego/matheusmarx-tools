/**
 * Escrita do PDF: as primitivas de cada página viram texto, linhas, retângulos
 * e imagens de verdade — o texto continua selecionável e pesquisável, e nada é
 * fotografado.
 */

import type { FontRef, Prim } from "./primitives";
import type { FontManager } from "./fonts";
import type { ImageRef } from "./model";

type Lib = typeof import("@cantoo/pdf-lib");
type PDFDocument = import("@cantoo/pdf-lib").PDFDocument;
type PDFPage = import("@cantoo/pdf-lib").PDFPage;
type PDFFont = import("@cantoo/pdf-lib").PDFFont;
type PDFImage = import("@cantoo/pdf-lib").PDFImage;
type RGB = ReturnType<Lib["rgb"]>;

/** Um grupo de primitivas desenhado numa página, deslocado e recortado. */
export interface DrawLayer {
  prims: Prim[];
  /** Página = primitiva + deslocamento, em pontos. */
  dx: number;
  dy: number;
  /** Faixa vertical da página que esta camada pode ocupar. */
  clip?: { top: number; bottom: number };
}

export interface PageDraw {
  width: number;
  height: number;
  layers: DrawLayer[];
}

/** Só as primitivas de uma faixa do fluxo; o texto vai pela linha de base. */
export function slicePrims(prims: Prim[], y0: number, y1: number): Prim[] {
  const out: Prim[] = [];
  for (const p of prims) {
    if (p.kind === "text") {
      if (p.y > y0 + 0.01 && p.y <= y1 + 0.01) out.push(p);
      continue;
    }
    let top: number;
    let bottom: number;
    if (p.kind === "line") {
      top = Math.min(p.y1, p.y2) - p.width / 2;
      bottom = Math.max(p.y1, p.y2) + p.width / 2;
    } else {
      top = p.y;
      bottom = p.y + p.h;
    }
    if (p.kind === "link") {
      const middle = (top + bottom) / 2;
      if (middle > y0 && middle <= y1) out.push(p);
      continue;
    }
    if (bottom > y0 + 0.01 && top < y1 - 0.01) out.push(p);
  }
  return out;
}

const SAFE_LINK = /^(https?:|mailto:)/i;

function parseColor(lib: Lib, value: string | null | undefined): RGB | null {
  if (!value) return null;
  const c = value.trim().toLowerCase();
  if (!c || c === "transparent" || c === "auto" || c === "none") return null;
  let m = /^#([0-9a-f]{6})$/.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (m) return lib.rgb(parseInt(m[1], 16) / 15, parseInt(m[2], 16) / 15, parseInt(m[3], 16) / 15);
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 4 && parts[3] === 0) return null;
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return lib.rgb(parts[0] / 255, parts[1] / 255, parts[2] / 255);
    }
  }
  return null;
}

/** Imagem que o PDF não aceita direto (GIF, BMP, WebP, SVG): vira PNG. */
async function rasterize(image: ImageRef): Promise<Uint8Array | null> {
  const url = URL.createObjectURL(new Blob([image.data.slice()], { type: image.mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // SVG não tem resolução: desenhado a 300 dpi do tamanho na página.
    const scale = image.mime === "image/svg+xml" ? 300 / 72 : 1;
    const w = Math.max(1, Math.round(image.mime === "image/svg+xml" ? image.width * scale : img.naturalWidth));
    const h = Math.max(1, Math.round(image.mime === "image/svg+xml" ? image.height * scale : img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0;
    canvas.height = 0;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const fontId = (f: FontRef) => (f.key === "symbols" ? "symbols" : `${f.key}|${f.bold ? 1 : 0}|${f.italic ? 1 : 0}`);

/** Recursos do PDF criados sob demanda e reaproveitados entre as páginas. */
class Resources {
  private readonly fonts = new Map<string, Promise<PDFFont | null>>();
  private readonly images = new Map<number, Promise<PDFImage | null>>();

  constructor(
    private readonly lib: Lib,
    private readonly doc: PDFDocument,
    private readonly manager: FontManager,
    private readonly imageRefs: ImageRef[],
  ) {}

  font(ref: FontRef): Promise<PDFFont | null> {
    const id = fontId(ref);
    let p = this.fonts.get(id);
    if (!p) {
      const loaded = this.manager.get(ref.key, ref.bold, ref.italic);
      // Ligaduras e kerning desligados: a página foi montada assim no
      // navegador (e o Word também não liga por padrão), então a largura de
      // cada palavra no PDF é a mesma usada para quebrar a linha.
      p = loaded
        ? this.doc.embedFont(new Uint8Array(loaded.bytes), {
            subset: true,
            features: { liga: false, clig: false, calt: false, dlig: false, kern: false },
          })
        : Promise.resolve(null);
      this.fonts.set(id, p);
    }
    return p;
  }

  image(index: number): Promise<PDFImage | null> {
    let p = this.images.get(index);
    if (!p) {
      const ref = this.imageRefs[index];
      p = (async () => {
        if (!ref) return null;
        try {
          if (ref.mime === "image/png") return await this.doc.embedPng(ref.data);
          if (ref.mime === "image/jpeg") return await this.doc.embedJpg(ref.data);
        } catch {
          // PNG ou JPEG que o pdf-lib não lê: o navegador ainda pode ler.
        }
        const png = await rasterize(ref);
        return png ? await this.doc.embedPng(png) : null;
      })();
      this.images.set(index, p);
    }
    return p;
  }

  color(value: string | null | undefined): RGB | null {
    return parseColor(this.lib, value);
  }
}

/** Palavras vizinhas separadas por um espaço normal viram um texto só. */
async function mergeWords(res: Resources, prims: Extract<Prim, { kind: "text" }>[]) {
  const out: (Extract<Prim, { kind: "text" }> & { pdfFont: PDFFont })[] = [];
  for (const p of prims) {
    const font = await res.font(p.font);
    if (!font) continue;
    const last = out[out.length - 1];
    if (
      last && !p.spacing && !last.spacing && last.pdfFont === font && last.size === p.size && last.color === p.color &&
      Math.abs(last.y - p.y) < 0.01
    ) {
      const expected = last.x + font.widthOfTextAtSize(`${last.text} `, p.size);
      if (Math.abs(expected - p.x) < 0.2) {
        last.text += ` ${p.text}`;
        continue;
      }
    }
    out.push({ ...p, pdfFont: font });
  }
  return out;
}

async function drawLayer(lib: Lib, res: Resources, page: PDFPage, layer: DrawLayer) {
  const H = page.getHeight();
  const W = page.getWidth();
  const X = (x: number) => x + layer.dx;
  const Y = (y: number) => H - (y + layer.dy);
  const clipped = layer.clip !== undefined;
  const ops = lib;
  if (clipped) {
    const top = Math.max(0, layer.clip!.top - 0.75);
    const bottom = Math.min(H, layer.clip!.bottom + 0.75);
    page.pushOperators(ops.pushGraphicsState(), ops.rectangle(-1, H - bottom, W + 2, bottom - top), ops.clip(), ops.endPath());
  }

  const texts: Extract<Prim, { kind: "text" }>[] = [];
  for (const p of layer.prims) {
    switch (p.kind) {
      case "rect": {
        const color = res.color(p.color);
        if (!color || p.w <= 0 || p.h <= 0) break;
        page.drawRectangle({ x: X(p.x), y: Y(p.y + p.h), width: p.w, height: p.h, color });
        break;
      }
      case "line": {
        const color = res.color(p.color);
        if (!color || p.width <= 0) break;
        page.drawLine({
          start: { x: X(p.x1), y: Y(p.y1) },
          end: { x: X(p.x2), y: Y(p.y2) },
          thickness: p.width,
          color,
          dashArray: p.dash,
          // Ponta quadrada: os cantos das bordas de tabela fecham sem falha.
          lineCap: p.dash ? lib.LineCapStyle.Butt : lib.LineCapStyle.Projecting,
        });
        break;
      }
      case "image": {
        const image = await res.image(p.index);
        if (!image || p.w <= 0 || p.h <= 0) break;
        page.drawImage(image, { x: X(p.x), y: Y(p.y + p.h), width: p.w, height: p.h });
        break;
      }
      case "shape": {
        const fill = res.color(p.fill);
        const stroke = res.color(p.stroke);
        if (!fill && !stroke) break;
        const common = {
          color: fill ?? undefined,
          borderColor: stroke ?? undefined,
          borderWidth: stroke ? p.strokeWidth : 0,
        };
        if (p.geometry === "ellipse") {
          page.drawEllipse({ x: X(p.x + p.w / 2), y: Y(p.y + p.h / 2), xScale: p.w / 2, yScale: p.h / 2, ...common });
        } else if (p.geometry === "line") {
          if (stroke) page.drawLine({ start: { x: X(p.x), y: Y(p.y) }, end: { x: X(p.x + p.w), y: Y(p.y + p.h) }, thickness: p.strokeWidth, color: stroke });
        } else if (p.geometry === "roundRect") {
          // Raio padrão do Word: 1/6 do lado menor.
          const r = Math.min(p.w, p.h) / 6;
          const { w, h } = p;
          const d = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
          page.drawSvgPath(d, { x: X(p.x), y: Y(p.y), ...common });
        } else {
          page.drawRectangle({ x: X(p.x), y: Y(p.y + p.h), width: p.w, height: p.h, ...common });
        }
        break;
      }
      case "watermark": {
        const font = await res.font(p.font);
        const color = res.color(p.color);
        const unit = font?.widthOfTextAtSize(p.text, 1) ?? 0;
        if (!font || !color || unit <= 0) break;
        // O WordArt estica o texto até encher a caixa da forma, nas duas
        // direções, e gira em torno do centro dela.
        const ascent = font.heightAtSize(1, { descender: false });
        const full = font.heightAtSize(1);
        const angle = (-p.rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        page.pushOperators(
          ops.pushGraphicsState(),
          ops.concatTransformationMatrix(cos, sin, -sin, cos, X(p.x + p.w / 2), Y(p.y + p.h / 2)),
          ops.concatTransformationMatrix(p.w / unit, 0, 0, p.h / full, 0, 0),
        );
        page.drawText(p.text, { x: -unit / 2, y: -full / 2 + (full - ascent), size: 1, font, color, opacity: p.opacity });
        page.pushOperators(ops.popGraphicsState());
        break;
      }
      case "text":
        texts.push(p);
        break;
      case "link":
        break;
    }
  }

  if (clipped) page.pushOperators(ops.popGraphicsState());

  // Texto por cima de fundos e bordas, e sem recorte: a linha inteira vai para
  // a página em que a linha de base caiu.
  for (const t of await mergeWords(res, texts)) {
    const color = res.color(t.color) ?? lib.rgb(0, 0, 0);
    if (t.spacing) page.pushOperators(ops.setCharacterSpacing(t.spacing));
    page.drawText(t.text, { x: X(t.x), y: Y(t.y), size: t.size, font: t.pdfFont, color });
    if (t.spacing) page.pushOperators(ops.setCharacterSpacing(0));
  }

  for (const p of layer.prims) {
    if (p.kind !== "link" || !SAFE_LINK.test(p.url)) continue;
    const doc = page.doc;
    const annotation = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [X(p.x), Y(p.y + p.h), X(p.x + p.w), Y(p.y)],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: lib.PDFString.of(p.url) },
    });
    page.node.addAnnot(doc.context.register(annotation));
  }
}

export async function writePdf(
  pages: PageDraw[],
  fonts: FontManager,
  images: ImageRef[],
  options: { title?: string; onPage?: (index: number) => void } = {},
): Promise<Uint8Array> {
  const lib = await import("@cantoo/pdf-lib");
  const fontkit = (await import("@cantoo/fontkit")).default;
  const doc = await lib.PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  if (options.title) doc.setTitle(options.title);
  const res = new Resources(lib, doc, fonts, images);
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const page = doc.addPage([p.width, p.height]);
    for (const layer of p.layers) await drawLayer(lib, res, page, layer);
    options.onPage?.(i);
  }
  return doc.save();
}
