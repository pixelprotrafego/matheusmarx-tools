/**
 * Montagem do documento no navegador, com as regras do Word.
 *
 * O navegador faz o que ele faz melhor — medir texto e quebrar linhas, com a
 * fonte certa — e este módulo cuida de que o resto siga o Word, e não o CSS:
 *
 * - espaço antes e depois do parágrafo **somam** (no CSS, as margens de dois
 *   parágrafos vizinhos se sobrepõem);
 * - a entrelinha é a do Word: "1,5" multiplica a altura natural da fonte, e
 *   não o corpo da letra;
 * - marcadores de lista são texto de verdade, e não pseudoelementos, para o
 *   PDF poder desenhá-los;
 * - tabulações param nas posições do documento, inclusive à direita e no
 *   ponto decimal, com pontilhado quando há.
 *
 * Unidades: tudo em pontos no CSS; o que se mede volta em pixels (1 px = 0,75 pt).
 */

import type { Anchor, Block, Cell, ImageRef, Inline, Paragraph, RunProps, Table } from "./model";
import { cssFamily, fontKeyFor, type FontManager } from "./fonts";

export const PX = 0.75;

export interface Floater {
  /** Marca no fluxo, para saber em que página e altura o objeto se ancora. */
  marker: HTMLElement;
  anchor: Anchor;
  /** Conteúdo desenhado fora do fluxo (imagem ou caixa de texto). */
  element: HTMLElement;
  width: number;
  height: number;
}

export interface RenderContext {
  fonts: FontManager;
  defaultTab: number;
  /** Número de cada nota de rodapé, na ordem em que é chamada no texto. */
  footnoteNumbers: Map<string, string>;
  /** Número da nota que está sendo montada (para o `footnoteRef` dela). */
  currentFootnote: string | null;
  images: ImageRef[];
  objectUrls: string[];
  floaters: Floater[];
  /** Onde os objetos flutuantes são montados, fora do fluxo. */
  floaterHost: HTMLElement;
  compatMode: number;
}

const BROWSER_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp", "image/webp", "image/svg+xml"]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/** Quanto o espaço pode encolher numa linha justificada (Word 2013+). */
const JUSTIFY_SHRINK = 0.245;

/**
 * Corpo efetivo do trecho. Expoente e índice saem a 0,63 do corpo, e o
 * expoente sobe 0,37 do corpo (medido no Word, com a Calibri).
 */
export const effectiveSize = (props: RunProps) => (props.vertAlign ? props.size * 0.63 : props.size);

/** Altura da linha simples do Word para o trecho. */
const naturalHeight = (ctx: RenderContext, props: RunProps) =>
  ctx.fonts.lineHeight(fontKeyFor(props.font), effectiveSize(props), props.bold, props.italic);

/** Altura de linha do trecho conforme a regra de entrelinha do parágrafo. */
function runLineHeight(ctx: RenderContext, p: Paragraph, props: RunProps): number {
  const natural = naturalHeight(ctx, props);
  if (p.props.lineRule === "exact") return p.props.line;
  if (p.props.lineRule === "atLeast") return Math.max(p.props.line, natural);
  return natural * p.props.line;
}

/**
 * Onde o Word põe a linha de base, a partir do alto da linha, para o trecho
 * que manda na altura das linhas do parágrafo (o de maior corpo).
 *
 * Medido no Word: na entrelinha múltipla (1,5, duplo) o espaço extra fica todo
 * abaixo do texto; na "pelo menos", todo acima; na exata, a linha de base fica
 * a 80% da altura da linha. O CSS centraliza o texto na linha e ainda arredonda
 * as medidas da fonte para o pixel; a coleta mede onde o navegador pôs a linha
 * de base e corrige pela diferença (ver `primitives.ts`).
 */
function markWordBaseline(ctx: RenderContext, p: Paragraph, inner: HTMLElement): void {
  let dominant = p.props.markProps;
  let best = -1;
  const consider = (props: RunProps) => {
    const h = naturalHeight(ctx, props);
    if (h > best) {
      best = h;
      dominant = props;
    }
  };
  for (const i of p.inlines) {
    if ((i.kind === "text" || i.kind === "field" || i.kind === "footnote") && !i.props.vertAlign) consider(i.props);
  }
  if (p.marker) consider(p.marker.props);
  if (best < 0) best = naturalHeight(ctx, dominant);
  // Entrelinha múltipla: o extra fica abaixo do texto, e na última linha da
  // página ele pode passar da margem de baixo (só o texto precisa caber).
  const extra = p.props.lineRule === "auto" ? Math.max(0, (p.props.line - 1) * best) : 0;
  inner.dataset.extra = String(extra);
  const key = fontKeyFor(dominant.font);
  const size = effectiveSize(dominant);
  const ascent = ctx.fonts.ascent(key, size, dominant.bold, dominant.italic);
  const line = p.props.line;
  const base =
    p.props.lineRule === "exact" ? 0.8 * line
    : p.props.lineRule === "atLeast" ? Math.max(0, line - best) + ascent
    : ascent;
  inner.dataset.wordBase = String(base);
  inner.dataset.domFamily = cssFamily(key);
  inner.dataset.domWeight = dominant.bold ? "700" : "400";
  inner.dataset.domStyle = dominant.italic ? "italic" : "normal";
  inner.dataset.domSize = `${size}pt`;
  inner.dataset.domLh = `${runLineHeight(ctx, p, dominant)}pt`;
}

function styleRun(ctx: RenderContext, span: HTMLElement, props: RunProps, p: Paragraph | null) {
  const key = fontKeyFor(props.font);
  const size = effectiveSize(props);
  span.style.fontFamily = cssFamily(key);
  span.style.fontSize = `${size}pt`;
  span.style.fontWeight = props.bold ? "700" : "400";
  span.style.fontStyle = props.italic ? "italic" : "normal";
  if (props.color) span.style.color = props.color;
  if (props.spacing) {
    span.style.letterSpacing = `${props.spacing}pt`;
    span.dataset.spacing = String(props.spacing);
  }
  // Em medida absoluta: "super" e "sub" do CSS dependem do corpo do bloco,
  // que aqui é zero (ver `renderParagraph`).
  if (props.vertAlign === "superscript") span.style.verticalAlign = `${props.size * 0.37}pt`;
  if (props.vertAlign === "subscript") span.style.verticalAlign = `${-props.size * 0.14}pt`;
  if (props.position) {
    span.style.position = "relative";
    span.style.top = `${-props.position}pt`;
  }
  if (p) span.style.lineHeight = `${runLineHeight(ctx, p, props)}pt`;
  if (p && p.props.align === "justify" && ctx.compatMode >= 15) {
    // Texto justificado no Word 2013 ou mais novo: para caber na linha, os
    // espaços podem encolher até ~24,5% (medido no Word: 24% cabe, 25% não).
    // A quebra de linha passa a considerar o espaço encolhido; a justificação
    // do navegador devolve a sobra, e a última linha (que não é justificada)
    // volta ao espaço normal na coleta.
    const space = ctx.fonts.spaceEm(key, props.bold, props.italic) * size;
    const shrink = space * JUSTIFY_SHRINK;
    span.style.wordSpacing = `${-shrink}pt`;
    span.dataset.shrink = String(shrink);
    span.dataset.space = String(space);
  }
  // Expoente e índice não aumentam a linha (no Word, quase nada: 0,2 pt na
  // nota de rodapé; no CSS, com o arredondamento, quase 1 pt).
  if (props.vertAlign) span.style.lineHeight = "0";
  span.dataset.font = key;
  span.dataset.bold = props.bold ? "1" : "0";
  span.dataset.italic = props.italic ? "1" : "0";
  span.dataset.size = String(size);
  span.dataset.color = props.color ?? "#000000";
  if (props.underline) span.dataset.underline = props.underline;
  if (props.strike) span.dataset.strike = "1";
  if (props.doubleStrike) span.dataset.strike = "2";
  if (props.highlight) span.dataset.bg = props.highlight;
  else if (props.shading) span.dataset.bg = props.shading;
}

/** Trecho de texto, com versalete partido em pedaços como o Word desenha. */
function textSpans(ctx: RenderContext, text: string, props: RunProps, p: Paragraph | null): HTMLElement[] {
  let t = props.caps ? text.toUpperCase() : text;
  if (!props.smallCaps || props.caps) {
    const span = el("span", "run");
    styleRun(ctx, span, props, p);
    span.textContent = t;
    return [span];
  }
  // Versalete: minúsculas viram maiúsculas menores (0,8 do corpo, como o Word).
  const out: HTMLElement[] = [];
  t = text;
  for (const m of t.matchAll(/(\p{Ll}+)|([^\p{Ll}]+)/gu)) {
    const lower = Boolean(m[1]);
    const span = el("span", "run");
    styleRun(ctx, span, lower ? { ...props, size: props.size * 0.8 } : props, p);
    span.textContent = lower ? m[0].toUpperCase() : m[0];
    out.push(span);
  }
  return out;
}

function imageElement(ctx: RenderContext, image: ImageRef): HTMLElement {
  if (BROWSER_IMAGES.has(image.mime)) {
    const img = el("img");
    const url = URL.createObjectURL(new Blob([image.data.slice()], { type: image.mime }));
    ctx.objectUrls.push(url);
    img.src = url;
    img.style.width = `${image.width}pt`;
    img.style.height = `${image.height}pt`;
    img.dataset.img = String(ctx.images.length);
    ctx.images.push(image);
    return img;
  }
  // EMF, WMF e TIFF: o navegador não sabe desenhar. O espaço é mantido, para a
  // paginação não mudar.
  const box = el("span", "noimg");
  box.style.display = "inline-block";
  box.style.width = `${image.width}pt`;
  box.style.height = `${image.height}pt`;
  return box;
}

/** Caixa de texto ou forma: um bloco de tamanho fixo com conteúdo próprio. */
function boxElement(ctx: RenderContext, inline: Extract<Inline, { kind: "box" }>): HTMLElement {
  const box = el("div", "box");
  box.style.width = `${inline.width}pt`;
  box.style.height = `${inline.height}pt`;
  box.style.boxSizing = "border-box";
  box.style.overflow = "hidden";
  const [t, r, b, l] = inline.padding;
  box.style.padding = `${t}pt ${r}pt ${b}pt ${l}pt`;
  if (inline.shape) {
    box.dataset.shape = inline.shape.geometry;
    if (inline.shape.fill) box.dataset.fill = inline.shape.fill;
    if (inline.shape.stroke) {
      box.dataset.stroke = inline.shape.stroke;
      box.dataset.strokeWidth = String(inline.shape.strokeWidth);
    }
  }
  if (inline.watermark) {
    box.dataset.watermark = JSON.stringify({ ...inline.watermark, font: fontKeyFor(inline.watermark.font) });
  }
  if (inline.blocks.length) renderBlocks(ctx, inline.blocks, box, inline.width - l - r);
  return box;
}

/** Monta os trechos de um parágrafo dentro do elemento interno dele. */
function renderInlines(ctx: RenderContext, p: Paragraph, inner: HTMLElement, width: number): void {
  for (const inline of p.inlines) {
    switch (inline.kind) {
      case "text": {
        const spans = textSpans(ctx, inline.text, inline.props, p);
        if (inline.link) {
          const a = el("a");
          a.dataset.href = inline.link;
          a.style.textDecoration = "none";
          a.style.color = "inherit";
          spans.forEach((s) => a.appendChild(s));
          inner.appendChild(a);
        } else spans.forEach((s) => inner.appendChild(s));
        break;
      }
      case "tab": {
        const tab = el("span", "tab");
        styleRun(ctx, tab, inline.props, p);
        tab.style.display = "inline-block";
        tab.style.width = "0pt";
        inner.appendChild(tab);
        break;
      }
      case "break": {
        if (inline.type === "column") {
          const mark = el("span", "colbreak");
          inner.appendChild(mark);
        }
        // A quebra leva a fonte do trecho: uma linha que só tem a quebra tem
        // a altura dessa fonte, como no Word.
        const strut = el("span", "run");
        styleRun(ctx, strut, inline.props, p);
        strut.textContent = "\u200B";
        inner.appendChild(strut);
        inner.appendChild(el("br"));
        break;
      }
      case "field": {
        const span = el("span", "run field");
        styleRun(ctx, span, inline.props, p);
        span.dataset.field = inline.field;
        span.textContent = inline.fallback.trim() || "1";
        inner.appendChild(span);
        break;
      }
      case "footnote": {
        const span = el("span", "run fnref");
        styleRun(ctx, span, inline.props, p);
        const n = inline.id === "self" ? ctx.currentFootnote : ctx.footnoteNumbers.get(inline.id);
        span.textContent = String(n ?? "");
        // Só a nota de rodapé reserva espaço no pé da página; a de fim vai
        // para o fim do documento.
        if (inline.id !== "self" && !inline.id.startsWith("e")) span.dataset.fn = inline.id;
        inner.appendChild(span);
        break;
      }
      case "image":
      case "box": {
        const content = inline.kind === "image" ? imageElement(ctx, inline.image) : boxElement(ctx, inline);
        const anchor = inline.anchor;
        if (!anchor) {
          content.style.verticalAlign = "baseline";
          if (inline.kind === "box") content.style.display = "inline-block";
          inner.appendChild(content);
          break;
        }
        if (anchor.wrap === "square" || anchor.wrap === "tight" || anchor.wrap === "through") {
          // Texto contornando: um float do lado em que o objeto está.
          const objectWidth = inline.kind === "image" ? inline.image.width : inline.width;
          const right =
            anchor.hAlign === "right" || anchor.hAlign === "outside" ||
            (anchor.hAlign === null && anchor.hOffset + objectWidth / 2 > width / 2);
          content.style.float = right ? "right" : "left";
          content.style.display = "block";
          content.style.marginTop = `${Math.max(0, anchor.vRelative === "paragraph" ? anchor.vOffset : 0) + anchor.distTop}pt`;
          content.style.marginBottom = `${anchor.distBottom}pt`;
          content.style.marginLeft = right ? `${anchor.distLeft}pt` : `${Math.max(0, anchor.hAlign ? 0 : anchor.hOffset - (p.props.indLeft ?? 0))}pt`;
          content.style.marginRight = `${anchor.distRight}pt`;
          inner.insertBefore(content, inner.firstChild);
          break;
        }
        if (anchor.wrap === "topAndBottom") {
          content.style.display = "block";
          const objectWidth = inline.kind === "image" ? inline.image.width : inline.width;
          const left =
            anchor.hAlign === "center" ? (width - objectWidth) / 2
            : anchor.hAlign === "right" ? width - objectWidth
            : anchor.hOffset;
          content.style.marginLeft = `${Math.max(0, left - p.props.indLeft)}pt`;
          content.style.marginTop = `${anchor.distTop + Math.max(0, anchor.vRelative === "paragraph" ? anchor.vOffset : 0)}pt`;
          content.style.marginBottom = `${anchor.distBottom}pt`;
          inner.insertBefore(content, inner.firstChild);
          break;
        }
        // Sem contorno (atrás ou na frente do texto): fora do fluxo.
        const marker = el("span", "anchor");
        inner.appendChild(marker);
        content.style.position = "absolute";
        content.style.left = "0";
        content.style.top = "0";
        ctx.floaterHost.appendChild(content);
        ctx.floaters.push({
          marker,
          anchor,
          element: content,
          width: inline.kind === "image" ? inline.image.width : inline.width,
          height: inline.kind === "image" ? inline.image.height : inline.height,
        });
        break;
      }
    }
  }
}

function borderCss(b: { width: number; color: string; style: string } | undefined): string {
  if (!b || b.width <= 0) return "none";
  return `${b.width}pt ${b.style === "double" ? "double" : b.style} ${b.color}`;
}

/** Espaço depois do parágrafo, já com a regra de "mesmo estilo". */
const spaceAfterOf = (p: Paragraph, next: Block | undefined) =>
  p.props.contextual && next?.kind === "p" && next.props.styleId === p.props.styleId ? 0 : p.props.spaceAfter;

export function renderParagraph(ctx: RenderContext, p: Paragraph, previous: Block | undefined, next: Block | undefined, width: number): HTMLElement {
  const outer = el("div", "p");
  if (p.breakOnly) {
    outer.dataset.breakBefore = "1";
    outer.dataset.before = "0";
    outer.dataset.after = "0";
    return outer;
  }
  let before = p.props.spaceBefore;
  const after = spaceAfterOf(p, next);
  // "Não adicionar espaço entre parágrafos do mesmo estilo".
  if (p.props.contextual && previous?.kind === "p" && previous.props.styleId === p.props.styleId) before = 0;
  // Entre dois parágrafos o Word não soma o espaço depois de um com o antes do
  // outro: fica o maior dos dois (medido no Word). O anterior já pôs o dele.
  if (previous?.kind === "p") before = Math.max(0, before - spaceAfterOf(previous, p));
  outer.style.paddingTop = `${before}pt`;
  outer.style.paddingBottom = `${after}pt`;
  outer.dataset.before = String(before);
  outer.dataset.after = String(after);
  if (p.props.keepNext) outer.dataset.keepNext = "1";
  if (p.props.keepLines) outer.dataset.keepLines = "1";
  if (p.props.pageBreakBefore) outer.dataset.breakBefore = "1";
  if (p.props.widowControl) outer.dataset.widow = "1";

  const inner = el("div", "pi");
  inner.style.marginLeft = `${p.props.indLeft}pt`;
  inner.style.marginRight = `${p.props.indRight}pt`;
  inner.style.textIndent = `${p.props.indFirst}pt`;
  inner.style.textAlign = p.props.align === "justify" ? "justify" : p.props.align;
  inner.style.whiteSpace = "pre-wrap";
  inner.style.overflowWrap = "break-word";
  if (p.props.shading) inner.dataset.bg = p.props.shading;
  const { top, bottom, left, right } = p.props.borders;
  if (top || bottom || left || right) {
    inner.style.borderTop = borderCss(top);
    inner.style.borderBottom = borderCss(bottom);
    inner.style.borderLeft = borderCss(left);
    inner.style.borderRight = borderCss(right);
    if (top) inner.style.paddingTop = `${top.space}pt`;
    if (bottom) inner.style.paddingBottom = `${bottom.space}pt`;
    if (left) inner.style.paddingLeft = `${left.space}pt`;
    if (right) inner.style.paddingRight = `${right.space}pt`;
    inner.dataset.borders = "1";
  }
  // A marca de parágrafo só dá a altura da linha quando não há texto (medido
  // no Word: texto de 8 pt com a marca em 20 pt fica com linhas de 8 pt). Com
  // texto, o bloco não tem "escora" própria e a linha sai só dos trechos.
  const mark = p.props.markProps;
  const markKey = fontKeyFor(mark.font);
  const hasText =
    p.marker !== null ||
    p.inlines.some((i) => (i.kind === "text" && i.text.length > 0) || i.kind === "field" || i.kind === "footnote");
  if (hasText) {
    inner.style.fontSize = "0";
    inner.style.lineHeight = "0";
  } else {
    inner.style.fontFamily = cssFamily(markKey);
    inner.style.fontSize = `${mark.size}pt`;
    inner.style.lineHeight = `${runLineHeight(ctx, p, mark)}pt`;
  }
  markWordBaseline(ctx, p, inner);
  outer.dataset.extra = inner.dataset.extra ?? "0";

  if (p.marker) {
    for (const s of textSpans(ctx, p.marker.text, p.marker.props, p)) {
      s.classList.add("marker");
      inner.appendChild(s);
    }
    if (p.marker.suffix === "tab") {
      const tab = el("span", "tab");
      styleRun(ctx, tab, p.marker.props, p);
      tab.style.display = "inline-block";
      tab.style.width = "0pt";
      tab.dataset.marker = "1";
      inner.appendChild(tab);
    } else if (p.marker.suffix === "space") {
      for (const s of textSpans(ctx, " ", p.marker.props, p)) inner.appendChild(s);
    }
  }

  renderInlines(ctx, p, inner, width - p.props.indLeft - p.props.indRight);
  if (inner.lastChild?.nodeName === "BR") {
    // Quebra de linha no fim do parágrafo: o Word mostra a linha vazia que
    // vem depois dela, com a altura da marca de parágrafo; o CSS não.
    const tail = el("span", "run");
    styleRun(ctx, tail, mark, p);
    tail.textContent = "\u200B";
    inner.appendChild(tail);
  }
  const visible = Array.from(inner.childNodes).some((n) => (n.textContent ?? "").length > 0 || n.nodeName === "IMG" || (n as HTMLElement).classList?.contains("box"));
  if (!visible) {
    // Parágrafo vazio ocupa a linha da marca de parágrafo.
    const strut = el("span", "run");
    styleRun(ctx, strut, mark, p);
    strut.textContent = "\u200B";
    inner.appendChild(strut);
  }
  outer.appendChild(inner);
  (outer as HTMLElement & { __para?: Paragraph }).__para = p;
  return outer;
}

/** Linhas da tabela com a mescla vertical resolvida em `rowspan`. */
function rowSpans(table: Table): Map<Cell, number> {
  const spans = new Map<Cell, number>();
  const columnOf = (rowIndex: number, cell: Cell) => {
    const row = table.rows[rowIndex];
    let col = row.gridBefore;
    for (const c of row.cells) {
      if (c === cell) return col;
      col += c.span;
    }
    return col;
  };
  table.rows.forEach((row, r) => {
    for (const cell of row.cells) {
      if (cell.vMerge !== "restart") continue;
      const col = columnOf(r, cell);
      let span = 1;
      for (let rr = r + 1; rr < table.rows.length; rr++) {
        let c0 = table.rows[rr].gridBefore;
        const below = table.rows[rr].cells.find((c) => {
          const at = c0;
          c0 += c.span;
          return at === col;
        });
        if (below?.vMerge === "continue") span++;
        else break;
      }
      spans.set(cell, span);
    }
  });
  return spans;
}

export function renderTable(ctx: RenderContext, t: Table, availableWidth: number): HTMLElement {
  const wrap = el("div", "tbl");
  const gridTotal = t.grid.reduce((a, b) => a + b, 0);
  const declared = t.width ? (t.width.type === "pt" ? t.width.value : (t.width.value / 100) * availableWidth) : null;
  // O Word grava na grade as larguras que ele calculou, e elas valem. Há
  // geradores que gravam uma grade de enfeite (5 pt por coluna) numa tabela
  // de ajuste automático: o Word recalcula as colunas pelo conteúdo, e aqui
  // o navegador faz o mesmo.
  const autoLayout = !t.fixed && declared !== null && gridTotal < declared * 0.5;
  const total = autoLayout ? declared! : gridTotal;
  const firstCell = t.rows[0]?.cells[0];
  // Modo de compatibilidade antigo (< 15): o recuo é medido até o texto da
  // primeira célula, e a borda fica para fora da margem.
  const shift = ctx.compatMode < 15 ? -(firstCell?.margins.left ?? 5.4) : 0;
  const left =
    t.align === "center" ? (availableWidth - total) / 2
    : t.align === "right" ? availableWidth - total
    : t.indent + shift;
  wrap.style.marginLeft = `${left}pt`;
  const table = el("table");
  table.style.borderCollapse = "collapse";
  table.style.tableLayout = autoLayout ? "auto" : "fixed";
  table.style.width = `${total}pt`;
  const colgroup = el("colgroup");
  for (const w of t.grid) {
    const col = el("col");
    if (!autoLayout) col.style.width = `${w}pt`;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);
  const spans = rowSpans(t);
  const tbody = el("tbody");
  t.rows.forEach((row) => {
    const tr = el("tr");
    if (row.header) tr.dataset.header = "1";
    if (row.cantSplit) tr.dataset.cantSplit = "1";
    // Altura da linha (medido no Word): na "pelo menos", a altura é a do
    // conteúdo e as margens de cima e de baixo da célula somam-se a ela; na
    // "exata", a altura já inclui as margens.
    if (row.height && row.heightRule !== "auto") {
      const margins = row.heightRule === "atLeast" ? Math.max(0, ...row.cells.map((c) => c.margins.top + c.margins.bottom)) : 0;
      tr.style.height = `${row.height + margins}pt`;
    }
    if (row.gridBefore) {
      const filler = el("td");
      filler.colSpan = row.gridBefore;
      filler.style.padding = "0";
      tr.appendChild(filler);
    }
    let col = row.gridBefore;
    for (const cell of row.cells) {
      const start = col;
      col += cell.span;
      if (cell.vMerge === "continue") continue;
      const td = el("td");
      td.colSpan = cell.span;
      const rs = spans.get(cell);
      if (rs && rs > 1) td.rowSpan = rs;
      const m = cell.margins;
      td.style.padding = `${m.top}pt ${m.right}pt ${m.bottom}pt ${m.left}pt`;
      td.style.verticalAlign = cell.vAlign === "center" ? "middle" : cell.vAlign;
      td.style.borderTop = borderCss(cell.borders.top);
      td.style.borderBottom = borderCss(cell.borders.bottom);
      td.style.borderLeft = borderCss(cell.borders.left);
      td.style.borderRight = borderCss(cell.borders.right);
      if (cell.shading) td.dataset.bg = cell.shading;
      if (row.heightRule === "exact" && row.height) {
        td.style.height = `${Math.max(0, row.height - m.top - m.bottom)}pt`;
        td.style.overflow = "hidden";
      }
      if (autoLayout && cell.width) td.style.width = `${cell.width - m.left - m.right}pt`;
      const cellWidth = autoLayout
        ? (cell.width ?? (total * cell.span) / Math.max(1, t.grid.length)) - m.left - m.right
        : t.grid.slice(start, start + cell.span).reduce((a, b) => a + b, 0) - m.left - m.right;
      const content = el("div", "cell");
      renderBlocks(ctx, cell.blocks.length ? cell.blocks : [], content, Math.max(4, cellWidth));
      td.appendChild(content);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

export function renderBlocks(ctx: RenderContext, blocks: Block[], container: HTMLElement, width: number): void {
  blocks.forEach((b, i) => {
    if (b.kind === "p") container.appendChild(renderParagraph(ctx, b, blocks[i - 1], blocks[i + 1], width));
    else container.appendChild(renderTable(ctx, b, width));
  });
}

// ------------------------------------------------------------- tabulações

/**
 * Larguras das tabulações, da esquerda para a direita.
 *
 * Cada tabulação vai até a próxima parada depois de onde ela começa: as
 * paradas do parágrafo, a do recuo pendente de um item de lista e, por fim, as
 * paradas padrão (a cada 1,25 cm). À direita e centralizada, o texto que vem
 * depois é que encosta na parada; com pontilhado, o vão é marcado para o PDF
 * desenhar os pontos.
 */
export function layoutTabs(ctx: RenderContext, root: HTMLElement): void {
  for (const inner of Array.from(root.querySelectorAll<HTMLElement>("div.pi"))) {
    const tabs = Array.from(inner.querySelectorAll<HTMLElement>(":scope > span.tab, :scope > a > span.tab"));
    if (!tabs.length) continue;
    const outer = inner.parentElement as HTMLElement & { __para?: Paragraph };
    const p = outer.__para;
    if (!p) continue;
    // Origem das paradas: a borda esquerda do texto da coluna (ou da célula).
    const origin = (outer.parentElement ?? root).getBoundingClientRect().left;
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      tab.style.width = "0pt";
      const x = (tab.getBoundingClientRect().left - origin) * PX;
      const stops = p.props.tabs.filter((s) => s.align !== "clear" && s.align !== "bar" && s.pos > x + 0.5);
      let stop: { pos: number; align: string; leader: string } | undefined = stops[0];
      const hanging = p.props.indFirst < 0 ? p.props.indLeft : null;
      if ((!stop || (hanging !== null && hanging > x + 0.5 && hanging < stop.pos)) && hanging !== null && hanging > x + 0.5) {
        stop = { pos: hanging, align: "left", leader: "none" };
      }
      if (!stop) {
        const pos = Math.floor((x + 0.5) / ctx.defaultTab + 1) * ctx.defaultTab;
        stop = { pos, align: "left", leader: "none" };
      }
      let width = stop.pos - x;
      if (stop.align === "right" || stop.align === "center" || stop.align === "decimal") {
        const range = document.createRange();
        range.setStartAfter(tab);
        if (tabs[i + 1]) range.setEndBefore(tabs[i + 1]);
        else range.setEnd(inner, inner.childNodes.length);
        const tabTop = tab.getBoundingClientRect().top;
        const rects = Array.from(range.getClientRects()).filter((r) => Math.abs(r.top - tabTop) < 20 && r.width > 0);
        let follow = rects.length ? (Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left))) * PX : 0;
        if (stop.align === "decimal") {
          const text = range.toString();
          const at = text.search(/[.,]/);
          if (at > 0) follow *= at / text.length;
        }
        width = stop.align === "center" ? stop.pos - x - follow / 2 : stop.pos - x - follow;
      }
      tab.style.width = `${Math.max(0, width)}pt`;
      if (stop.leader !== "none") tab.dataset.leader = stop.leader;
    }
  }
}
