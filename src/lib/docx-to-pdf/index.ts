/**
 * Word para PDF, no navegador.
 *
 * 1. O .docx é lido para um modelo já resolvido (estilos, numeração, seções).
 * 2. O documento é montado num contêiner fora da tela, com fontes de métrica
 *    idêntica às do Office e as regras de parágrafo do Word.
 * 3. A paginação corta o fluxo onde o Word cortaria (viúvas e órfãs, "manter
 *    com o próximo", quebras, notas de rodapé, cabeçalho de tabela repetido).
 * 4. Cada página vira um PDF vetorial: texto real, selecionável, na posição
 *    exata em que foi medido.
 *
 * Nada sai do computador do usuário.
 */

import { readDocx } from "./parse";
import { FontManager, fontKeyFor, type FontKey } from "./fonts";
import { layoutTabs, renderBlocks, PX, type Floater, type RenderContext } from "./render-dom";
import { measureFlow, type FlowMetrics } from "./measure";
import { paginate, type PlannedPage, type RunningKind, type SectionLayout } from "./paginate";
import { collectPrims, type FontRef, type GlyphCheck, type Prim } from "./primitives";
import { slicePrims, writePdf, type DrawLayer, type PageDraw } from "./pdf";
import type { Block, DocModel, RunProps, SectionProps } from "./model";
import { formatNumber } from "./numbering";

export interface DocxToPdfOptions {
  /** Andamento de 0 a 1, com uma frase sobre a etapa. */
  onProgress?: (fraction: number, status: string) => void;
  /** Onde estão as fontes (padrão: /fonts/docx/). */
  fontBaseUrl?: string;
}

export interface DocxToPdfResult {
  bytes: Uint8Array;
  pages: number;
}

const BASE_CSS = `
.docx-host { position: absolute; left: 0; top: 0; color: #000; background: #fff;
  font-kerning: none; font-variant-ligatures: none; font-synthesis: none;
  text-rendering: geometricPrecision; line-height: normal; font-size: 11pt;
  -webkit-text-size-adjust: none; text-size-adjust: none; }
.docx-host * { margin: 0; padding: 0; border: 0; box-sizing: content-box; }
.docx-host .flow, .docx-host .part, .docx-host .fn { display: flow-root; position: relative; }
.docx-host img { display: inline-block; max-width: none; max-height: none; vertical-align: baseline; }
.docx-host table { border-collapse: collapse; border-spacing: 0; table-layout: fixed; }
.docx-host td { vertical-align: top; }
.docx-host .pi { white-space: pre-wrap; }
.docx-host .floaters { position: absolute; left: 0; top: 0; }
`;

type Visitor = { run(p: RunProps): void; footnote(id: string): void };

function walkBlocks(blocks: Block[] | undefined, visit: Visitor) {
  for (const b of blocks ?? []) {
    if (b.kind === "p") {
      visit.run(b.props.markProps);
      if (b.marker) visit.run(b.marker.props);
      for (const i of b.inlines) {
        visit.run(i.props);
        if (i.kind === "footnote" && i.id !== "self") visit.footnote(i.id);
        if (i.kind === "box") walkBlocks(i.blocks, visit);
        if (i.kind === "box" && i.watermark) visit.run({ ...i.props, font: i.watermark.font, bold: false, italic: false });
      }
    } else {
      for (const r of b.rows) for (const c of r.cells) walkBlocks(c.blocks, visit);
    }
  }
}

/** Fontes usadas e ordem das notas de rodapé, numa passada pelo documento. */
function survey(model: DocModel) {
  const fonts = new Map<string, { key: FontKey; bold: boolean; italic: boolean }>();
  const order: string[] = [];
  const endOrder: string[] = [];
  const add = (p: RunProps) => {
    const key = fontKeyFor(p.font);
    fonts.set(`${key}|${p.bold}|${p.italic}`, { key, bold: p.bold, italic: p.italic });
    fonts.set(`${key}|false|false`, { key, bold: false, italic: false });
  };
  const visitor: Visitor = {
    run: add,
    footnote: (id) => {
      const list = id.startsWith("e") ? endOrder : order;
      if (!list.includes(id)) list.push(id);
    },
  };
  for (const s of model.sections) walkBlocks(s.blocks, visitor);
  const quiet: Visitor = { run: add, footnote: () => {} };
  for (const s of model.sections) {
    for (const blocks of [...Object.values(s.props.headers), ...Object.values(s.props.footers)]) walkBlocks(blocks, quiet);
  }
  for (const id of order) walkBlocks(model.footnotes.get(id), quiet);
  for (const id of endOrder) walkBlocks(model.endnotes.get(id), quiet);
  return { fonts: [...fonts.values()], footnoteOrder: order, endnoteOrder: endOrder };
}

function textWidth(p: SectionProps) {
  return Math.max(36, p.pageWidth - p.margins.left - p.margins.right - p.margins.gutter);
}

function columnGeometry(p: SectionProps) {
  const total = textWidth(p);
  const n = Math.max(1, p.columns.count);
  const left0 = p.margins.left + p.margins.gutter;
  if (n === 1) return { width: total, lefts: [left0] };
  if (p.columns.widths && p.columns.widths.length >= n) {
    const lefts: number[] = [];
    let x = left0;
    for (let i = 0; i < n; i++) {
      lefts.push(x);
      x += p.columns.widths[i] + p.columns.space;
    }
    return { width: p.columns.widths[0], lefts };
  }
  const width = (total - p.columns.space * (n - 1)) / n;
  return { width, lefts: Array.from({ length: n }, (_, i) => left0 + i * (width + p.columns.space)) };
}

const ptHeight = (el: HTMLElement) => el.getBoundingClientRect().height * PX;

function glyphChecker(fonts: FontManager, fontkit: typeof import("@cantoo/fontkit").default): GlyphCheck {
  type FkFont = import("@cantoo/fontkit").Font;
  const cache = new Map<string, FkFont | null>();
  const get = (f: FontRef): FkFont | null => {
    const id = `${f.key}|${f.bold}|${f.italic}`;
    if (cache.has(id)) return cache.get(id)!;
    const loaded = fonts.get(f.key, f.bold, f.italic);
    let font: FkFont | null = null;
    if (loaded) {
      try {
        const created = fontkit.create(new Uint8Array(loaded.bytes));
        font = "fonts" in created ? created.fonts[0] ?? null : created;
      } catch {
        font = null;
      }
    }
    cache.set(id, font);
    return font;
  };
  const symbols: FontRef = { key: "symbols", bold: false, italic: false };
  return {
    has(font, cp) {
      const f = get(font);
      if (!f || f.hasGlyphForCodePoint(cp)) return true;
      // Só vai para a fonte de símbolos o que ela desenha; o resto fica na
      // principal, como o navegador também fez.
      const s = get(symbols);
      return !(s && s.hasGlyphForCodePoint(cp));
    },
    advance(font, text, size) {
      const f = get(font);
      if (!f) return size * 0.5;
      return (f.layout(text, { liga: false, kern: false }).advanceWidth / f.unitsPerEm) * size;
    },
  };
}

interface Placed {
  x: number;
  y: number;
}

/** Posição na página de um objeto flutuante, pela âncora do Word. */
function placeFloater(
  f: Floater,
  page: PlannedPage,
  para: { top: number } | null,
  marker: { x: number; y: number } | null,
): Placed {
  const a = f.anchor;
  const W = page.width;
  const H = page.height;
  const m = page.margins;
  let hs: number;
  let he: number;
  switch (a.hRelative) {
    case "page": hs = 0; he = W; break;
    case "leftMargin": case "insideMargin": hs = 0; he = m.left; break;
    case "rightMargin": case "outsideMargin": hs = W - m.right; he = W; break;
    case "column": case "paragraph": hs = page.columnLeft; he = page.columnLeft + page.columnWidth; break;
    case "character": hs = marker?.x ?? m.left; he = hs; break;
    default: hs = m.left; he = W - m.right;
  }
  let x: number;
  if (a.hAlign === "left" || a.hAlign === "inside") x = hs;
  else if (a.hAlign === "right" || a.hAlign === "outside") x = he - f.width;
  else if (a.hAlign === "center") x = hs + (he - hs - f.width) / 2;
  else x = hs + a.hOffset;

  let vs: number;
  let ve: number;
  switch (a.vRelative) {
    case "page": vs = 0; ve = H; break;
    case "topMargin": case "insideMargin": vs = 0; ve = m.top; break;
    case "bottomMargin": case "outsideMargin": vs = H - m.bottom; ve = H; break;
    case "paragraph": vs = para?.top ?? m.top; ve = vs; break;
    case "line": vs = marker?.y ?? para?.top ?? m.top; ve = vs; break;
    default: vs = m.top; ve = H - m.bottom;
  }
  let y: number;
  if (a.vAlign === "top" || a.vAlign === "inside") y = vs;
  else if (a.vAlign === "bottom" || a.vAlign === "outside") y = ve - f.height;
  else if (a.vAlign === "center") y = vs + (ve - vs - f.height) / 2;
  else y = vs + a.vOffset;
  return { x, y };
}

const waitImages = (root: ParentNode) =>
  Promise.all(
    Array.from(root.querySelectorAll("img")).map((img) =>
      img.decode().catch(() => undefined),
    ),
  );

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export async function docxToPdf(data: ArrayBuffer, options: DocxToPdfOptions = {}): Promise<DocxToPdfResult> {
  const progress = options.onProgress ?? (() => {});
  progress(0.05, "Lendo o documento...");
  const model = await readDocx(data);

  progress(0.15, "Carregando as fontes...");
  const fonts = new FontManager(options.fontBaseUrl);
  const { fonts: needed, footnoteOrder, endnoteOrder } = survey(model);
  await Promise.all([
    fonts.load("symbols", false, false),
    fonts.load("liberation-sans", false, false),
    ...needed.map((f) => fonts.load(f.key, f.bold, f.italic)),
  ]);
  const fontkit = (await import("@cantoo/fontkit")).default;
  const glyphs = glyphChecker(fonts, fontkit);

  // Contêiner fora da tela, isolado do CSS do site (que mexe em imagem,
  // tabela e entrelinha).
  const outer = document.createElement("div");
  outer.setAttribute("aria-hidden", "true");
  outer.style.cssText = "position:absolute;left:-200000px;top:0;width:0;height:0;overflow:hidden;pointer-events:none;";
  const shadow = outer.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = BASE_CSS;
  shadow.appendChild(style);
  const host = document.createElement("div");
  host.className = "docx-host";
  shadow.appendChild(host);
  const floaterHost = document.createElement("div");
  floaterHost.className = "floaters";
  host.appendChild(floaterHost);
  document.body.appendChild(outer);

  // Rótulo de cada nota: as de rodapé em 1, 2, 3; as de fim em i, ii, iii
  // (o padrão do Word para cada uma).
  const footnoteNumbers = new Map<string, string>();
  footnoteOrder.forEach((id, i) => footnoteNumbers.set(id, String(i + 1)));
  endnoteOrder.forEach((id, i) => footnoteNumbers.set(id, formatNumber(i + 1, "lowerRoman")));
  const ctx: RenderContext = {
    fonts,
    defaultTab: model.defaultTab,
    footnoteNumbers,
    currentFootnote: null,
    images: [],
    objectUrls: [],
    floaters: [],
    floaterHost,
    compatMode: model.compatMode,
  };

  try {
    progress(0.25, "Montando as páginas...");
    // Fluxo de cada seção, na largura da coluna.
    const flows: HTMLElement[] = [];
    const geometry = model.sections.map((s) => columnGeometry(s.props));
    model.sections.forEach((s, i) => {
      const flow = document.createElement("div");
      flow.className = "flow";
      flow.style.width = `${geometry[i].width}pt`;
      host.appendChild(flow);
      renderBlocks(ctx, s.blocks, flow, geometry[i].width);
      flows.push(flow);
    });

    // Notas de fim: no fim do documento, depois de um traço como o das notas
    // de rodapé, e paginadas com o resto do texto.
    if (endnoteOrder.length) {
      const last = flows.length - 1;
      const normal = model.normalRun;
      const lineHeight = fonts.lineHeight(fontKeyFor(normal.font), normal.size, normal.bold, normal.italic);
      const separator = document.createElement("div");
      separator.className = "p";
      separator.dataset.before = "0";
      separator.dataset.after = "0";
      // Traço de 0,75 pt com o centro a 59% da linha (medido no PDF do Word).
      separator.style.paddingBottom = `${lineHeight * 0.407 - 0.375}pt`;
      const rule = document.createElement("div");
      rule.dataset.borders = "1";
      rule.style.width = "144pt";
      rule.style.height = `${lineHeight * 0.593 - 0.375}pt`;
      rule.style.borderBottom = "0.75pt solid #000000";
      separator.appendChild(rule);
      flows[last].appendChild(separator);
      for (const id of endnoteOrder) {
        ctx.currentFootnote = footnoteNumbers.get(id) ?? null;
        renderBlocks(ctx, model.endnotes.get(id) ?? [], flows[last], geometry[last].width);
      }
      ctx.currentFootnote = null;
    }

    // Cabeçalhos e rodapés: um contêiner por parte (as seções que herdam a
    // mesma parte a compartilham).
    const parts = new Map<Block[], Map<number, HTMLElement>>();
    const partElement = (blocks: Block[] | undefined, width: number): HTMLElement | null => {
      if (!blocks || !blocks.length) return null;
      let byWidth = parts.get(blocks);
      if (!byWidth) parts.set(blocks, (byWidth = new Map()));
      const key = Math.round(width * 10);
      let el = byWidth.get(key);
      if (!el) {
        el = document.createElement("div");
        el.className = "part";
        el.style.width = `${width}pt`;
        host.appendChild(el);
        renderBlocks(ctx, blocks, el, width);
        byWidth.set(key, el);
      }
      return el;
    };
    const pick = <T,>(set: { default?: T; first?: T; even?: T }, kind: RunningKind) =>
      kind === "first" ? set.first : kind === "even" ? set.even : set.default;
    const headerOf = (sec: number, kind: RunningKind) => {
      const p = model.sections[sec].props;
      return partElement(pick(p.headers, kind), textWidth(p));
    };
    const footerOf = (sec: number, kind: RunningKind) => {
      const p = model.sections[sec].props;
      return partElement(pick(p.footers, kind), textWidth(p));
    };
    model.sections.forEach((_, i) => {
      for (const kind of ["default", "first", "even"] as RunningKind[]) {
        headerOf(i, kind);
        footerOf(i, kind);
      }
    });

    // Notas de rodapé, na largura do texto.
    const noteWidth = textWidth(model.sections[0].props);
    const notes = new Map<string, HTMLElement>();
    for (const id of footnoteOrder) {
      const wrapper = document.createElement("div");
      wrapper.className = "fn";
      wrapper.style.width = `${noteWidth}pt`;
      host.appendChild(wrapper);
      ctx.currentFootnote = footnoteNumbers.get(id) ?? null;
      renderBlocks(ctx, model.footnotes.get(id) ?? [], wrapper, noteWidth);
      notes.set(id, wrapper);
    }
    ctx.currentFootnote = null;

    await waitImages(host);
    await document.fonts.ready;
    await nextFrame();
    layoutTabs(ctx, host);

    progress(0.45, "Paginando...");
    const metrics: FlowMetrics[] = flows.map((f) => measureFlow(f));
    const noteHeights = new Map([...notes].map(([id, el]) => [id, ptHeight(el)]));
    // Separador das notas: um traço de 2 polegadas numa linha do estilo Normal.
    const normal = model.normalRun;
    const separatorHeight = fonts.lineHeight(fontKeyFor(normal.font), normal.size, normal.bold, normal.italic);
    const notesHeight = (ids: string[]) =>
      ids.length ? separatorHeight + ids.reduce((sum, id) => sum + (noteHeights.get(id) ?? 0), 0) : 0;

    const layouts: SectionLayout[] = model.sections.map((s, i) => ({
      index: i,
      props: s.props,
      flow: metrics[i],
      flowIndex: i,
      columnWidth: geometry[i].width,
      columnLefts: geometry[i].lefts,
      headerHeight: (kind) => {
        const el = headerOf(i, kind);
        return el ? ptHeight(el) : 0;
      },
      footerHeight: (kind) => {
        const el = footerOf(i, kind);
        return el ? ptHeight(el) : 0;
      },
    }));
    // Word 2013 ou mais novo: o espaço antes do parágrafo some no alto da
    // página também depois de uma quebra manual (medido no Word).
    const planned = paginate(layouts, notesHeight, model.evenAndOddHeaders, model.compatMode >= 15);
    const total = planned.length;
    const sectionTotals = new Map<number, number>();
    for (const p of planned) sectionTotals.set(p.section, Math.max(sectionTotals.get(p.section) ?? 0, p.sectionPage));

    progress(0.55, "Desenhando as páginas...");
    const flowPrims: Prim[][] = flows.map((f) => collectPrims(f, glyphs));
    const notePrims = new Map([...notes].map(([id, el]) => [id, collectPrims(el, glyphs)]));

    // Cabeçalho e rodapé com o número da página certo em cada página.
    const partPrims = new Map<string, Prim[]>();
    const partIds = new Map<HTMLElement, number>();
    const primsOfPart = (el: HTMLElement, page: PlannedPage): Prim[] => {
      const fields = Array.from(el.querySelectorAll<HTMLElement>("span.field[data-field]"));
      const texts = fields.map((f) =>
        f.dataset.field === "NUMPAGES" ? String(total)
        : f.dataset.field === "SECTIONPAGES" ? String(sectionTotals.get(page.section) ?? total)
        : String(page.number),
      );
      if (!partIds.has(el)) partIds.set(el, partIds.size);
      const key = `${partIds.get(el)}|${texts.join(",")}`;
      let prims = partPrims.get(key);
      if (!prims) {
        fields.forEach((f, i) => (f.textContent = texts[i]));
        if (fields.length) layoutTabs(ctx, el);
        prims = collectPrims(el, glyphs);
        partPrims.set(key, prims);
      }
      return prims;
    };

    // Objetos flutuantes: de que parte são e onde ancoram.
    const flowTop = flows.map((f) => f.getBoundingClientRect().top);
    const floaterPrims = new Map<Floater, Prim[]>(ctx.floaters.map((f) => [f, collectPrims(f.element, glyphs)]));
    const floatersOn = (page: PlannedPage, header: HTMLElement | null, footer: HTMLElement | null, headerY: number, footerY: number) => {
      const out: { floater: Floater; at: Placed }[] = [];
      for (const f of ctx.floaters) {
        const paraEl = f.marker.closest<HTMLElement>("div.pi");
        const mr = f.marker.getBoundingClientRect();
        for (const [owner, baseY] of [[header, headerY], [footer, footerY]] as const) {
          if (!owner || !owner.contains(f.marker)) continue;
          const top = owner.getBoundingClientRect().top;
          const para = paraEl ? { top: baseY + (paraEl.getBoundingClientRect().top - top) * PX } : null;
          const marker = { x: page.margins.left + (mr.left - owner.getBoundingClientRect().left) * PX, y: baseY + (mr.top - top) * PX };
          out.push({ floater: f, at: placeFloater(f, page, para, marker) });
        }
        for (const piece of page.pieces) {
          const flow = flows[piece.flow];
          if (!flow.contains(f.marker)) continue;
          const y = (mr.top - flowTop[piece.flow]) * PX;
          if (y < piece.y0 - 0.5 || y >= piece.y1) continue;
          const toPage = (v: number) => piece.y + Math.max(0, v - piece.y0);
          const para = paraEl ? { top: toPage((paraEl.getBoundingClientRect().top - flowTop[piece.flow]) * PX) } : null;
          const marker = { x: piece.x + (mr.left - flow.getBoundingClientRect().left) * PX, y: toPage(y) };
          out.push({ floater: f, at: placeFloater(f, page, para, marker) });
          break;
        }
      }
      return out.sort((a, b) => a.floater.anchor.z - b.floater.anchor.z);
    };

    const drawn: PageDraw[] = planned.map((page) => {
      const layers: DrawLayer[] = [];
      const m = page.margins;
      const header = headerOf(page.section, page.running);
      const footer = footerOf(page.section, page.running);
      const headerY = m.header;
      const footerY = footer ? page.height - m.footer - ptHeight(footer) : 0;
      const floaters = floatersOn(page, header, footer, headerY, footerY);
      const floaterLayer = (f: { floater: Floater; at: Placed }): DrawLayer => ({ prims: floaterPrims.get(f.floater) ?? [], dx: f.at.x, dy: f.at.y });

      for (const f of floaters) if (f.floater.anchor.behind) layers.push(floaterLayer(f));
      if (header) layers.push({ prims: primsOfPart(header, page), dx: m.left + m.gutter, dy: headerY });
      for (const piece of page.pieces) {
        layers.push({
          prims: slicePrims(flowPrims[piece.flow], piece.y0, piece.y1),
          dx: piece.x,
          dy: piece.y - piece.y0,
          clip: { top: piece.y, bottom: piece.y + (piece.y1 - piece.y0) },
        });
      }
      if (page.footnotes.length) {
        let y = page.bodyBottom - notesHeight(page.footnotes);
        // Posição e espessura medidas no PDF do Word: 0,75 pt, a 45% da linha.
        const lineY = y + separatorHeight * 0.45;
        layers.push({
          prims: [{ kind: "line", x1: 0, y1: lineY, x2: 144, y2: lineY, width: 0.75, color: "#000000" }],
          dx: page.columnLeft,
          dy: 0,
        });
        y += separatorHeight;
        for (const id of page.footnotes) {
          layers.push({ prims: notePrims.get(id) ?? [], dx: page.columnLeft, dy: y });
          y += noteHeights.get(id) ?? 0;
        }
      }
      if (footer) layers.push({ prims: primsOfPart(footer, page), dx: m.left + m.gutter, dy: footerY });
      for (const f of floaters) if (!f.floater.anchor.behind) layers.push(floaterLayer(f));
      return { width: page.width, height: page.height, layers };
    });

    progress(0.7, "Gravando o PDF...");
    const bytes = await writePdf(drawn, fonts, ctx.images, {
      onPage: (i) => progress(0.7 + (0.28 * (i + 1)) / drawn.length, `Gravando a página ${i + 1} de ${drawn.length}...`),
    });
    progress(1, "Pronto");
    return { bytes, pages: drawn.length };
  } finally {
    for (const url of ctx.objectUrls) URL.revokeObjectURL(url);
    outer.remove();
  }
}
