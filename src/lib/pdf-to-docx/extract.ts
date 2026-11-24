/**
 * Leitura de uma página de PDF em estruturas que o gerador de DOCX entende.
 *
 * O `getTextContent()` do pdf.js resolve só metade do problema: ele devolve o
 * texto e onde ele está, mas **não** devolve a cor, nem o nome real da fonte,
 * nem os traços vetoriais, nem as imagens. Sem cor, o texto branco sobre a
 * faixa colorida do cabeçalho sai preto e some; sem o nome real da fonte, o
 * documento inteiro sai na fonte padrão do Word.
 *
 * Por isso aqui se lê a página duas vezes: uma pelo `getTextContent()`, para
 * pegar o texto já normalizado e agrupado, e outra pela lista de operadores,
 * para reconstruir o estado gráfico (cor, fonte, matriz) em cada ponto em que o
 * PDF mandou desenhar texto. Os dois lados são casados por posição, que é o
 * único identificador comum entre eles.
 */

import { parseFontName } from "./fonts";
import type {
  FilledArea,
  PageContent,
  PdfLink,
  PlacedImage,
  Rgb,
  RuleSegment,
  StructBlock,
  StructRole,
  TextRun,
} from "./types";

type Matrix = [number, number, number, number, number, number];

/**
 * O pdf.js não exporta tipos para a lista de operadores nem para os objetos de
 * fonte e imagem; o que segue descreve só o que este módulo consome.
 */
interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number; transform: number[] };
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  getTextContent(params?: Record<string, unknown>): Promise<{ items: unknown[] }>;
  getAnnotations(): Promise<unknown[]>;
  getStructTree?(): Promise<unknown>;
  commonObjs: { get(id: string, cb?: (v: unknown) => void): unknown; has(id: string): boolean };
  objs: { get(id: string, cb?: (v: unknown) => void): unknown; has(id: string): boolean };
}

interface PdfLibLike {
  OPS: Record<string, number>;
  Util: { transform(a: number[], b: number[]): number[] };
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (a: number[], b: number[]): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

const applyPoint = (m: number[], x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

const BLACK: Rgb = { r: 0, g: 0, b: 0 };

const toRgb = (value: unknown): Rgb => {
  if (Array.isArray(value)) {
    return { r: value[0] ?? 0, g: value[1] ?? 0, b: value[2] ?? 0 };
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, number>;
    return { r: o[0] ?? o.r ?? 0, g: o[1] ?? o.g ?? 0, b: o[2] ?? o.b ?? 0 };
  }
  return { ...BLACK };
};

/**
 * Forma pequena e quase quadrada pintada na página: candidata a bala de lista.
 * O Chromium e outros geradores desenham a bala como um círculo vetorial, e
 * não como letra — sem isto, os itens de lista saíam sem bala nenhuma.
 */
interface SmallMark {
  x: number;
  y: number;
  width: number;
  height: number;
  color: Rgb;
  round: boolean;
}

/** O que interessa de uma fonte do PDF. */
interface FontInfo {
  name: string;
  fallback: string;
  unitsPerEm: number;
  /** Marcas do descritor da fonte: pegam o negrito de fonte com nome cifrado. */
  bold: boolean;
  italic: boolean;
}

/** Estado gráfico salvo/restaurado por `save` e `restore`. */
interface GState {
  ctm: Matrix;
  fill: Rgb;
  stroke: Rgb;
  lineWidth: number;
  fillAlpha: number;
}

/** Um ponto em que o PDF mandou desenhar texto, com o estilo daquele momento. */
interface StyleEvent {
  x: number;
  y: number;
  fill: Rgb;
  fontRef: string | null;
  size: number;
  /** Modo de renderização 3 é texto invisível — camada de OCR, por exemplo. */
  invisible: boolean;
  /**
   * Preenchido e contornado (modo 2): é como o Word e outros geradores
   * desenham negrito quando a fonte não tem a variante negrita.
   */
  fakeBold: boolean;
}

/** Espera um objeto do pdf.js que pode ainda estar sendo decodificado. */
const resolveObject = (store: PdfPageLike["objs"], id: string): Promise<unknown> =>
  new Promise((resolve) => {
    try {
      if (store.has(id)) {
        resolve(store.get(id));
        return;
      }
    } catch {
      /* ainda não resolvido: cai no callback */
    }
    try {
      store.get(id, resolve);
    } catch {
      resolve(null);
    }
  });

/**
 * Percorre a lista de operadores reconstruindo o estado gráfico.
 *
 * É uma interpretação parcial de propósito: só o que sobrevive à viagem até um
 * DOCX. Curvas, padrões, transparência e espaços de cor exóticos são ignorados,
 * porque o formato de destino não tem onde guardá-los.
 */
async function walkOperators(
  pdfjs: PdfLibLike,
  page: PdfPageLike,
  viewportTransform: number[],
  rasterize: (image: unknown, width: number, height: number) => Promise<EncodedImage | null>,
): Promise<{
  styles: StyleEvent[];
  images: PlacedImage[];
  rules: RuleSegment[];
  fills: FilledArea[];
  fontNames: Map<string, FontInfo>;
  marks: SmallMark[];
}> {
  const { OPS } = pdfjs;
  const list = await page.getOperatorList();

  const styles: StyleEvent[] = [];
  const images: PlacedImage[] = [];
  const rules: RuleSegment[] = [];
  const fills: FilledArea[] = [];
  const fontNames = new Map<string, FontInfo>();

  let gs: GState = { ctm: [...viewportTransform] as Matrix, fill: { ...BLACK }, stroke: { ...BLACK }, lineWidth: 1, fillAlpha: 1 };
  const stack: GState[] = [];

  // Estado de texto.
  let textMatrix: Matrix = [...IDENTITY];
  let lineMatrix: Matrix = [...IDENTITY];
  let fontRef: string | null = null;
  let fontSize = 0;
  let charSpacing = 0;
  let wordSpacing = 0;
  let hScale = 1;
  let leading = 0;
  let renderMode = 0;
  let fontUnitsPerEm = 0.001;

  const marks: SmallMark[] = [];
  /** O caminho em construção tem curva? Círculo de bala, e não quadrado. */
  let pathHasCurve = false;
  /** Caminho em construção, já em coordenadas da viewport. */
  let path: { x: number; y: number }[][] = [];
  let pendingRects: { x: number; y: number; w: number; h: number }[] = [];
  let imageOrder = 0;

  /** Um ponto do espaço do usuário na página, pelo CTM em vigor agora. */
  const pointOf = (px: number, py: number) => {
    const [vx, vy] = applyPoint(gs.ctm, px, py);
    return { x: vx, y: vy };
  };

  const cloneState = (s: GState): GState => ({
    ctm: [...s.ctm] as Matrix,
    fill: { ...s.fill },
    stroke: { ...s.stroke },
    lineWidth: s.lineWidth,
    fillAlpha: s.fillAlpha,
  });

  /** Guarda os segmentos horizontais e verticais de um caminho pintado. */
  const emitPath = (mode: "fill" | "stroke") => {
    const color = mode === "fill" ? gs.fill : gs.stroke;
    const scale = Math.hypot(gs.ctm[0], gs.ctm[1]) || 1;

    if (mode === "fill") {
      const shapes = [
        ...path.map((sub) => ({ xs: sub.map((p) => p.x), ys: sub.map((p) => p.y), round: pathHasCurve })),
        ...pendingRects.map((r) => ({ xs: [r.x, r.x + r.w], ys: [r.y, r.y + r.h], round: false })),
      ];
      for (const shape of shapes) {
        if (!shape.xs.length) continue;
        const x = Math.min(...shape.xs);
        const y = Math.min(...shape.ys);
        const w = Math.max(...shape.xs) - x;
        const h = Math.max(...shape.ys) - y;
        if (w >= 1.5 && w <= 8 && h >= 1.5 && h <= 8 && Math.abs(w - h) <= 1.5) {
          marks.push({ x, y, width: w, height: h, color: { ...color }, round: shape.round });
        }
      }
    }

    for (const rect of pendingRects) {
      const w = Math.abs(rect.w);
      const h = Math.abs(rect.h);
      const x = Math.min(rect.x, rect.x + rect.w);
      const y = Math.min(rect.y, rect.y + rect.h);

      if (mode === "fill" && w > 2 && h > 2) {
        fills.push({ x, y, width: w, height: h, color, order: imageOrder++ });
      }
      // Retângulo fino é filete: borda de tabela, sublinhado, régua.
      if (h <= 3 && w > 3) rules.push({ axis: "h", position: y + h / 2, from: x, to: x + w, thickness: Math.max(h, 0.5), color, filled: mode === "fill" });
      if (w <= 3 && h > 3) rules.push({ axis: "v", position: x + w / 2, from: y, to: y + h, thickness: Math.max(w, 0.5), color, filled: mode === "fill" });
      // Contorno de retângulo grande: as quatro bordas são filetes de verdade.
      if (mode === "stroke" && w > 3 && h > 3) {
        const t = gs.lineWidth * scale;
        rules.push({ axis: "h", position: y, from: x, to: x + w, thickness: t, color, filled: false });
        rules.push({ axis: "h", position: y + h, from: x, to: x + w, thickness: t, color, filled: false });
        rules.push({ axis: "v", position: x, from: y, to: y + h, thickness: t, color, filled: false });
        rules.push({ axis: "v", position: x + w, from: y, to: y + h, thickness: t, color, filled: false });
      }
    }

    if (mode === "stroke") {
      const t = Math.max(gs.lineWidth * scale, 0.5);
      for (const sub of path) {
        for (let i = 1; i < sub.length; i++) {
          const a = sub[i - 1];
          const b = sub[i];
          if (Math.abs(a.y - b.y) <= 0.6 && Math.abs(a.x - b.x) > 2) {
            rules.push({ axis: "h", position: (a.y + b.y) / 2, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x), thickness: t, color, filled: false });
          } else if (Math.abs(a.x - b.x) <= 0.6 && Math.abs(a.y - b.y) > 2) {
            rules.push({ axis: "v", position: (a.x + b.x) / 2, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y), thickness: t, color, filled: false });
          }
        }
      }
    }

    path = [];
    pendingRects = [];
    pathHasCurve = false;
  };

  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as never[];

    switch (fn) {
      case OPS.save:
        stack.push(cloneState(gs));
        break;
      case OPS.restore:
        gs = stack.pop() ?? gs;
        break;
      case OPS.transform:
        gs.ctm = multiply(gs.ctm, args as unknown as number[]);
        break;
      // Form XObject: o conteúdo de dentro é desenhado com a matriz do próprio
      // form, como faz o canvas do pdf.js. Sem ela, logotipos, carimbos e
      // tabelas desenhados dentro de um form saíam no lugar errado da página.
      case OPS.paintFormXObjectBegin: {
        stack.push(cloneState(gs));
        const matrix = (args as unknown as [number[] | null])[0];
        if (Array.isArray(matrix) && matrix.length === 6) gs.ctm = multiply(gs.ctm, matrix);
        break;
      }
      case OPS.paintFormXObjectEnd:
        gs = stack.pop() ?? gs;
        break;
      case OPS.setLineWidth:
        gs.lineWidth = args[0] as unknown as number;
        break;
      case OPS.setFillRGBColor:
        gs.fill = toRgb(args);
        break;
      case OPS.setStrokeRGBColor:
        gs.stroke = toRgb(args);
        break;

      // ----- caminhos -----
      case OPS.constructPath: {
        const [subOps, coords] = args as unknown as [number[], number[]];
        let k = 0;
        let current: { x: number; y: number }[] = [];
        let cx = 0;
        let cy = 0;
        for (const op of subOps) {
          if (op === OPS.moveTo) {
            if (current.length > 1) path.push(current);
            [cx, cy] = [coords[k++], coords[k++]];
            current = [pointOf(cx, cy)];
          } else if (op === OPS.lineTo) {
            [cx, cy] = [coords[k++], coords[k++]];
            current.push(pointOf(cx, cy));
          } else if (op === OPS.curveTo) {
            pathHasCurve = true;
            k += 4;
            [cx, cy] = [coords[k++], coords[k++]];
            current.push(pointOf(cx, cy));
          } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
            pathHasCurve = true;
            k += 2;
            [cx, cy] = [coords[k++], coords[k++]];
            current.push(pointOf(cx, cy));
          } else if (op === OPS.closePath) {
            if (current.length > 1) current.push({ ...current[0] });
          } else if (op === OPS.rectangle) {
            const [rx, ry, rw, rh] = [coords[k++], coords[k++], coords[k++], coords[k++]];
            const p1 = pointOf(rx, ry);
            const p2 = pointOf(rx + rw, ry + rh);
            pendingRects.push({ x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) });
          }
        }
        if (current.length > 1) path.push(current);
        break;
      }
      case OPS.fill:
      case OPS.eoFill:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        emitPath("fill");
        break;
      case OPS.stroke:
      case OPS.closeStroke:
        emitPath("stroke");
        break;
      case OPS.clip:
      case OPS.eoClip:
        // Recorte não desenha nada; o `endPath` a seguir descarta o caminho.
        break;
      case OPS.endPath:
        path = [];
        pendingRects = [];
        pathHasCurve = false;
        break;

      // ----- texto -----
      case OPS.beginText:
        textMatrix = [...IDENTITY];
        lineMatrix = [...IDENTITY];
        break;
      case OPS.setFont: {
        fontRef = args[0] as unknown as string;
        fontSize = args[1] as unknown as number;
        if (fontRef && !fontNames.has(fontRef)) {
          const f = (await resolveObject(page.commonObjs, fontRef)) as
            | { name?: string; fallbackName?: string; fontMatrix?: number[]; bold?: boolean; black?: boolean; italic?: boolean }
            | null;
          fontNames.set(fontRef, {
            name: f?.name ?? "",
            fallback: f?.fallbackName ?? "",
            unitsPerEm: f?.fontMatrix?.[0] ?? 0.001,
            bold: Boolean(f?.bold || f?.black),
            italic: Boolean(f?.italic),
          });
        }
        // Relido a cada troca, e não só na primeira: voltar para uma fonte já
        // vista precisa restaurar a escala de glifo dela, senão o avanço do
        // texto passa a ser calculado com a métrica da fonte anterior.
        fontUnitsPerEm = (fontRef && fontNames.get(fontRef)?.unitsPerEm) || 0.001;
        break;
      }
      case OPS.setTextMatrix:
        textMatrix = [...(args as unknown as number[])] as Matrix;
        lineMatrix = [...textMatrix];
        break;
      case OPS.setLeading:
        leading = args[0] as unknown as number;
        break;
      case OPS.setLeadingMoveText:
        leading = -(args[1] as unknown as number);
        lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, args[0] as unknown as number, args[1] as unknown as number]);
        textMatrix = [...lineMatrix];
        break;
      case OPS.moveText:
        lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, args[0] as unknown as number, args[1] as unknown as number]);
        textMatrix = [...lineMatrix];
        break;
      case OPS.nextLine:
        lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, 0, -leading]);
        textMatrix = [...lineMatrix];
        break;
      case OPS.setCharSpacing:
        charSpacing = args[0] as unknown as number;
        break;
      case OPS.setWordSpacing:
        wordSpacing = args[0] as unknown as number;
        break;
      case OPS.setHScale:
        hScale = (args[0] as unknown as number) / 100;
        break;
      case OPS.setTextRenderingMode:
        renderMode = args[0] as unknown as number;
        break;
      case OPS.showText:
      case OPS.showSpacedText: {
        const placed = multiply(gs.ctm, textMatrix);
        // Modo 1 (só contorno) pinta com a cor do traço, não a de preenchimento.
        const mode = renderMode & 3;
        styles.push({
          x: placed[4],
          y: placed[5],
          fill: mode === 1 ? { ...gs.stroke } : { ...gs.fill },
          fontRef,
          size: fontSize,
          invisible: renderMode === 3 || renderMode === 7,
          fakeBold: mode === 2 && gs.lineWidth > 0,
        });
        // Avança a matriz de texto pela largura dos glifos, para o próximo
        // `showText` sem reposicionamento cair no x certo. Sem isso, dois
        // trechos de cores diferentes na mesma linha trocam de cor.
        const glyphs = (args[0] ?? []) as unknown as (
          | number
          | { width?: number; unicode?: string; isSpace?: boolean }
        )[];
        let advance = 0;
        if (Array.isArray(glyphs)) {
          for (const g of glyphs) {
            if (typeof g === "number") {
              advance -= (g / 1000) * fontSize * hScale;
              continue;
            }
            if (!g) continue;
            const w = (g.width ?? 0) * fontUnitsPerEm * fontSize;
            const extra = charSpacing + (g.isSpace ? wordSpacing : 0);
            advance += (w + extra) * hScale;
          }
        }
        textMatrix = multiply(textMatrix, [1, 0, 0, 1, advance, 0]);
        break;
      }

      // ----- imagens -----
      case OPS.paintImageXObject:
      case OPS.paintImageMaskXObject:
      case OPS.paintInlineImageXObject: {
        // Imagem embutida no fluxo vem como objeto pronto; as demais vêm por id.
        const first = args[0] as unknown;
        const image =
          typeof first === "string"
            ? await resolveObject(first.startsWith("g_") ? page.commonObjs : page.objs, first)
            : first;
        if (!image || typeof image !== "object") break;

        // O CTM mapeia o quadrado unitário na caixa onde a imagem é desenhada.
        const c0 = applyPoint(gs.ctm, 0, 0);
        const c1 = applyPoint(gs.ctm, 1, 1);
        const x = Math.min(c0[0], c1[0]);
        const y = Math.min(c0[1], c1[1]);
        const width = Math.abs(c1[0] - c0[0]);
        const height = Math.abs(c1[1] - c0[1]);
        if (!(width > 1 && height > 1)) break;

        const meta = image as { width?: number; height?: number };
        const encoded = await rasterize(image, meta.width ?? 0, meta.height ?? 0);
        if (!encoded) break;

        images.push({
          x, y, width, height,
          data: encoded.data,
          format: encoded.format,
          pixelWidth: meta.width ?? Math.round(width),
          pixelHeight: meta.height ?? Math.round(height),
          order: imageOrder++,
        });
        break;
      }
      default:
        break;
    }
  }

  return { styles, images, rules, fills, fontNames, marks };
}

/**
 * Converte um objeto de imagem do pdf.js em PNG, usando o canvas do navegador.
 *
 * Nunca lança: uma imagem que o pdf.js não conseguiu decodificar não pode
 * derrubar a conversão do documento inteiro — o resto do texto vale mais do
 * que aquela figura.
 */
interface EncodedImage {
  data: Uint8Array;
  format: "png" | "jpg";
}

async function imageToPng(image: unknown, width: number, height: number): Promise<EncodedImage | null> {
  try {
    return await encodeImage(image, width, height);
  } catch {
    return null;
  }
}

async function encodeImage(image: unknown, width: number, height: number): Promise<EncodedImage | null> {
  if (typeof document === "undefined" || !width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const src = image as {
    bitmap?: CanvasImageSource;
    data?: Uint8Array | Uint8ClampedArray;
    kind?: number;
  };

  if (src.bitmap) {
    ctx.drawImage(src.bitmap, 0, 0, width, height);
  } else if (src.data) {
    const out = ctx.createImageData(width, height);
    const data = src.data;
    // 1 = cinza 1 bit por pixel, 2 = RGB 24 bits, 3 = RGBA 32 bits.
    if (src.kind === 3 || data.length >= width * height * 4) {
      out.data.set(data.subarray(0, width * height * 4));
    } else if (src.kind === 2 || data.length >= width * height * 3) {
      for (let p = 0, q = 0; p < width * height * 3; p += 3, q += 4) {
        out.data[q] = data[p];
        out.data[q + 1] = data[p + 1];
        out.data[q + 2] = data[p + 2];
        out.data[q + 3] = 255;
      }
    } else {
      // 1bpp: cada bit é um pixel, empacotado por linha.
      const rowBytes = (width + 7) >> 3;
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const byte = data[row * rowBytes + (col >> 3)] ?? 0;
          const on = (byte >> (7 - (col & 7))) & 1;
          const q = (row * width + col) * 4;
          const v = on ? 255 : 0;
          out.data[q] = v;
          out.data[q + 1] = v;
          out.data[q + 2] = v;
          out.data[q + 3] = 255;
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  } else {
    return null;
  }

  // Foto e página escaneada vão em JPEG de alta qualidade; o resto em PNG,
  // sem perda. Transparência obriga PNG: JPEG não tem canal alfa.
  let opaque = true;
  if (width * height > 250_000) {
    const pixels = ctx.getImageData(0, 0, width, height).data;
    for (let i = 3; i < pixels.length; i += 4 * 97) {
      if (pixels[i] < 250) {
        opaque = false;
        break;
      }
    }
  }
  const format: EncodedImage["format"] = opaque && width * height > 250_000 ? "jpg" : "png";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, format === "jpg" ? "image/jpeg" : "image/png", 0.92));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), format };
}

/** Papéis da árvore de estrutura que fecham um bloco de texto. */
const BLOCK_ROLES = new Set<string>([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "Lbl", "LBody", "TD", "TH", "Caption", "Figure", "Title",
]);

interface StructNode {
  role?: string;
  type?: string;
  id?: string;
  children?: StructNode[];
}

/**
 * Achata a árvore de estrutura em blocos na ordem de leitura, e devolve também
 * o mapa de id de conteúdo para bloco.
 *
 * A árvore é a intenção do autor gravada no arquivo: onde começa cada
 * parágrafo, o que é item de lista, o que é célula de tabela. Ela é o caminho
 * exato; a geometria só entra para o que a árvore não diz (alinhamento, recuo,
 * espaçamento), e como plano B nos PDFs que não a trazem.
 */
function flattenStructTree(root: unknown): {
  blocks: StructBlock[];
  byContentId: Map<string, number>;
} {
  const blocks: StructBlock[] = [];
  const byContentId = new Map<string, number>();
  if (!root || typeof root !== "object") return { blocks, byContentId };

  let listCounter = -1;
  let tableCounter = -1;
  let rowCounter = -1;
  let cellCounter = -1;

  const visit = (
    node: StructNode,
    path: string[],
    ctx: { listItem: number | null; listDepth: number; table: number | null; row: number | null; cell: number | null },
  ) => {
    const role = node.role ?? "";
    let next = ctx;

    if (role === "LI") next = { ...next, listItem: ++listCounter };
    if (role === "L") next = { ...next, listDepth: next.listDepth + 1 };
    if (role === "Table") next = { ...next, table: ++tableCounter };
    if (role === "TR") next = { ...next, row: ++rowCounter };
    if (role === "TD" || role === "TH") next = { ...next, cell: ++cellCounter };

    const childPath = role ? [...path, role] : path;

    if (role && BLOCK_ROLES.has(role)) {
      const block: StructBlock = {
        order: blocks.length,
        role: role as StructRole,
        path: childPath,
        listItem: next.listItem,
        listDepth: next.listDepth,
        table: next.table,
        tableRow: next.row,
        tableCell: next.cell,
      };
      blocks.push(block);
      // Todo id de conteúdo abaixo daqui pertence a este bloco, inclusive os
      // que estão em sub-nós de formatação (`Span`, `Link`, `Figure` interno).
      const claim = (n: StructNode) => {
        if (n.type === "content" && n.id) byContentId.set(n.id, block.order);
        for (const c of n.children ?? []) claim(c);
      };
      claim(node);
    }

    for (const child of node.children ?? []) visit(child, childPath, next);
  };

  for (const child of (root as StructNode).children ?? []) {
    visit(child, [], { listItem: null, listDepth: 0, table: null, row: null, cell: null });
  }

  return { blocks, byContentId };
}

/** Encontra o estilo válido para um trecho de texto, pela posição na página. */
const styleAt = (events: StyleEvent[], x: number, y: number): StyleEvent | null => {
  let best: StyleEvent | null = null;
  for (const e of events) {
    if (Math.abs(e.y - y) > 1.5) continue;
    if (e.x > x + 1.5) continue;
    if (!best || e.x > best.x) best = e;
  }
  if (best) return best;
  // Sem nada na mesma linha de base: aceita o evento mais próximo na vertical,
  // que cobre texto rotacionado e casos em que o pdf.js reagrupou os trechos.
  let nearest: StyleEvent | null = null;
  let distance = Infinity;
  for (const e of events) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < distance) { distance = d; nearest = e; }
  }
  return distance < 40 ? nearest : null;
};

/** Lê uma página inteira. */
export async function extractPage(
  pdfjs: PdfLibLike,
  page: PdfPageLike,
  index: number,
): Promise<PageContent> {
  const viewport = page.getViewport({ scale: 1 });
  const { styles, images, rules, fills, fontNames, marks } = await walkOperators(
    pdfjs,
    page,
    viewport.transform,
    imageToPng,
  );

  let structBlocks: StructBlock[] = [];
  let byContentId = new Map<string, number>();
  try {
    const tree = await page.getStructTree?.();
    ({ blocks: structBlocks, byContentId } = flattenStructTree(tree));
  } catch {
    /* PDF sem árvore de estrutura: segue pela geometria */
  }

  const content = await page.getTextContent({ includeMarkedContent: true, disableNormalization: false });
  const runs: TextRun[] = [];
  const markedStack: { tag: string; id: string | null }[] = [];

  for (const raw of content.items) {
    const item = raw as {
      type?: string;
      tag?: string;
      id?: string | null;
      str?: string;
      transform?: number[];
      width?: number;
      height?: number;
      hasEOL?: boolean;
    };

    if (item.type === "beginMarkedContent" || item.type === "beginMarkedContentProps") {
      markedStack.push({ tag: item.tag ?? "", id: item.id ?? null });
      continue;
    }
    if (item.type === "endMarkedContent") {
      markedStack.pop();
      continue;
    }
    if (typeof item.str !== "string" || !item.transform) continue;

    const m = pdfjs.Util.transform(viewport.transform, item.transform);
    const x = m[4];
    const baseline = m[5];
    const size = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]);

    const event = styleAt(styles, x, baseline);
    if (event?.invisible) continue;

    // O id do marcado mais interno é o que aponta para o bloco mais fino da
    // árvore; os de fora só existem para agrupar.
    let structBlock: number | null = null;
    for (let s = markedStack.length - 1; s >= 0 && structBlock === null; s--) {
      const id = markedStack[s].id;
      if (id && byContentId.has(id)) structBlock = byContentId.get(id) ?? null;
    }

    const styleOf = (e: StyleEvent | null) => {
      const fontInfo = e?.fontRef ? fontNames.get(e.fontRef) : undefined;
      const parsed = parseFontName(fontInfo?.name, fontInfo?.fallback);
      return {
        family: parsed.family,
        size: Math.round(size * 100) / 100,
        bold: parsed.bold || Boolean(e?.fakeBold) || Boolean(fontInfo?.bold),
        italic: parsed.italic || Boolean(fontInfo?.italic),
        color: e?.fill ?? { ...BLACK },
      };
    };

    // O pdf.js junta num item só o texto contíguo da mesma linha, mesmo que a
    // cor ou a fonte mudem no meio ("e texto colorido."): o item inteiro
    // ficava com o estilo do começo, e o vermelho saía preto. O item é partido
    // onde o PDF trocou de estilo, na posição proporcional ao texto.
    const text = item.str;
    const width = item.width ?? 0;
    const cuts: { index: number; event: StyleEvent }[] = [];
    if (event && width > 0 && text.length > 1) {
      let current = event;
      const inside = styles
        .filter((e) => Math.abs(e.y - baseline) <= 1.5 && e.x > x + 0.5 && e.x < x + width - 0.5)
        .sort((a, b) => a.x - b.x);
      for (const e of inside) {
        const same = e.fontRef === current.fontRef && e.fill.r === current.fill.r && e.fill.g === current.fill.g &&
          e.fill.b === current.fill.b && e.fakeBold === current.fakeBold;
        if (same || e.invisible) continue;
        let index = Math.round(((e.x - x) / width) * text.length);
        // A troca de estilo quase sempre cai na fronteira de uma palavra.
        for (const d of [0, 1, -1, 2, -2]) {
          const i = index + d;
          if (i > 0 && i < text.length && (/\s/.test(text[i - 1]) || /\s/.test(text[i]))) {
            index = i;
            break;
          }
        }
        const last = cuts[cuts.length - 1]?.index ?? 0;
        if (index <= last || index >= text.length) continue;
        cuts.push({ index, event: e });
        current = e;
      }
    }

    const pieces = [{ from: 0, event }, ...cuts.map((c) => ({ from: c.index, event: c.event }))];
    pieces.forEach((piece, i) => {
      const to = i + 1 < pieces.length ? pieces[i + 1].from : text.length;
      const share = text.length ? width / text.length : 0;
      runs.push({
        text: text.slice(piece.from, to),
        x: x + piece.from * share,
        baseline,
        width: pieces.length > 1 ? (to - piece.from) * share : width,
        style: styleOf(piece.event),
        artifact: markedStack.some((m) => m.tag === "Artifact"),
        endsLine: Boolean(item.hasEOL) && to === text.length,
        structBlock,
      });
    });
  }

  // Bala desenhada como forma, logo antes do texto de uma linha: vira um
  // trecho "•" (ou "▪", se quadrada) na linha de base daquele texto, e a
  // detecção de lista cuida do resto.
  for (const mark of marks) {
    const cy = mark.y + mark.height / 2;
    const after = runs
      .filter((r) => r.text.trim() && r.x > mark.x + mark.width && r.x - (mark.x + mark.width) < 40)
      .filter((r) => cy <= r.baseline && cy >= r.baseline - r.style.size * 0.8)
      .sort((a, b) => a.x - b.x)[0];
    if (!after) continue;
    // Uma forma colada ao texto, dentro da palavra, não é bala.
    const before = runs.some(
      (r) => r.text.trim() && r.x < mark.x && r.x + r.width > mark.x - 4 && Math.abs(r.baseline - after.baseline) < 2,
    );
    if (before) continue;
    runs.push({
      text: mark.round ? "•" : "▪",
      x: mark.x,
      baseline: after.baseline,
      width: mark.width,
      style: { ...after.style, color: mark.color, bold: false, italic: false },
      artifact: after.artifact,
      endsLine: false,
      structBlock: after.structBlock,
    });
  }

  const links: PdfLink[] = [];
  try {
    const annotations = (await page.getAnnotations()) as {
      subtype?: string;
      url?: string;
      unsafeUrl?: string;
      rect?: number[];
    }[];
    for (const a of annotations) {
      const url = a.url ?? a.unsafeUrl;
      if (a.subtype !== "Link" || !url || !a.rect) continue;
      const p1 = pdfjs.Util.transform(viewport.transform, [1, 0, 0, 1, a.rect[0], a.rect[1]]);
      const p2 = pdfjs.Util.transform(viewport.transform, [1, 0, 0, 1, a.rect[2], a.rect[3]]);
      links.push({
        url,
        x: Math.min(p1[4], p2[4]),
        y: Math.min(p1[5], p2[5]),
        width: Math.abs(p2[4] - p1[4]),
        height: Math.abs(p2[5] - p1[5]),
      });
    }
  } catch {
    /* PDF sem anotações válidas: segue sem links */
  }

  return {
    index,
    width: viewport.width,
    height: viewport.height,
    runs,
    images,
    rules,
    fills,
    links,
    structBlocks,
  };
}
