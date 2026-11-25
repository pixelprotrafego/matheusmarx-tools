/**
 * Do documento montado no navegador para o que o PDF desenha.
 *
 * Cada palavra vira um texto posicionado exatamente onde o navegador a pôs —
 * com a mesma fonte que ele usou para quebrar a linha —, e fundos, bordas,
 * sublinhados e imagens viram retângulos, linhas e figuras. As medidas saem
 * em pontos, relativas ao canto superior esquerdo do elemento de origem.
 */

import type { FontKey } from "./fonts";
import { PX } from "./render-dom";
import { linesOf } from "./measure";

export type FontRef = { key: FontKey | "symbols"; bold: boolean; italic: boolean };

export type Prim =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: string; dash?: number[] }
  | { kind: "text"; x: number; y: number; size: number; text: string; font: FontRef; color: string; spacing?: number }
  | { kind: "image"; x: number; y: number; w: number; h: number; index: number }
  | { kind: "shape"; x: number; y: number; w: number; h: number; geometry: string; fill: string | null; stroke: string | null; strokeWidth: number }
  | { kind: "link"; x: number; y: number; w: number; h: number; url: string }
  | { kind: "watermark"; x: number; y: number; w: number; h: number; text: string; font: FontRef; color: string; opacity: number; rotation: number };

export interface GlyphCheck {
  /** A fonte tem desenho para este caractere? */
  has(font: FontRef, codePoint: number): boolean;
  /** Avanço de um texto, em pontos, para medir o pontilhado da tabulação. */
  advance(font: FontRef, text: string, size: number): number;
}

/** Linha de base e altura da caixa do texto, por fonte e corpo. */
const probeCache = new Map<string, { base: number; height: number }>();

function probe(span: HTMLElement): { base: number; height: number } {
  const key = `${span.style.fontFamily}|${span.style.fontWeight}|${span.style.fontStyle}|${span.style.fontSize}`;
  const cached = probeCache.get(key);
  if (cached) return cached;
  const box = document.createElement("span");
  box.style.cssText = `font-family:${span.style.fontFamily};font-weight:${span.style.fontWeight};font-style:${span.style.fontStyle};font-size:${span.style.fontSize};line-height:normal;white-space:pre;position:absolute;left:0;top:0;`;
  box.textContent = "Hx";
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;";
  box.appendChild(marker);
  // Montado junto do trecho, para valer o mesmo CSS (o documento é montado
  // num contêiner isolado do estilo do site).
  (span.closest(".docx-host") ?? span.ownerDocument.body).appendChild(box);
  const range = document.createRange();
  range.selectNodeContents(box.firstChild!);
  const text = range.getBoundingClientRect();
  const result = { base: (marker.getBoundingClientRect().bottom - text.top) * PX, height: text.height * PX };
  box.remove();
  probeCache.set(key, result);
  return result;
}

/** Correção da linha de base por parágrafo (ver `paragraphShift`). */
const shiftCache = new Map<string, number>();

/**
 * Quanto a linha de base do Word fica abaixo da que o navegador desenhou, num
 * parágrafo.
 *
 * Uma linha de teste com a mesma "escora" do parágrafo e o trecho que manda na
 * altura das linhas mostra onde o navegador põe a linha de base, a partir do
 * alto da linha — já com o arredondamento para o pixel que ele faz, e que
 * muda com a densidade da tela. O Word a põe em `wordBase`.
 */
function paragraphShift(para: HTMLElement): number {
  const d = para.dataset;
  if (d.wordBase === undefined) return 0;
  const key = [para.style.fontFamily, para.style.fontSize, para.style.lineHeight, d.domFamily, d.domWeight, d.domStyle, d.domSize, d.domLh, d.wordBase].join("|");
  const cached = shiftCache.get(key);
  if (cached !== undefined) return cached;
  const block = document.createElement("div");
  block.style.cssText = `position:absolute;left:0;top:0;width:10000px;white-space:pre;font-family:${para.style.fontFamily || "inherit"};font-size:${para.style.fontSize || "0"};line-height:${para.style.lineHeight || "0"};`;
  const span = document.createElement("span");
  span.style.cssText = `font-family:${d.domFamily};font-weight:${d.domWeight};font-style:${d.domStyle};font-size:${d.domSize};line-height:${d.domLh};`;
  span.textContent = "Hx";
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;";
  span.appendChild(marker);
  block.appendChild(span);
  (para.closest(".docx-host") ?? para.ownerDocument.body).appendChild(block);
  const browser = (marker.getBoundingClientRect().bottom - block.getBoundingClientRect().top) * PX;
  block.remove();
  const shift = Number(d.wordBase) - browser;
  shiftCache.set(key, shift);
  return shift;
}

/** Linha de base do trecho, a partir do alto da caixa do texto, onde o Word a põe. */
function baselineOffset(span: HTMLElement): number {
  const para = span.closest<HTMLElement>("div.pi");
  return probe(span).base + (para ? paragraphShift(para) : 0);
}

const fontOf = (span: HTMLElement): FontRef => ({
  key: (span.dataset.font as FontKey) ?? "liberation-sans",
  bold: span.dataset.bold === "1",
  italic: span.dataset.italic === "1",
});

const SYMBOLS: FontRef = { key: "symbols", bold: false, italic: false };

function borderLines(out: Prim[], rect: DOMRect, style: CSSStyleDeclaration, ox: number, oy: number, collapsed: boolean) {
  const x0 = (rect.left - ox) * PX;
  const y0 = (rect.top - oy) * PX;
  const x1 = (rect.right - ox) * PX;
  const y1 = (rect.bottom - oy) * PX;
  const side = (name: "Top" | "Right" | "Bottom" | "Left", a: [number, number], b: [number, number]) => {
    const kind = style.getPropertyValue(`border-${name.toLowerCase()}-style`);
    const width = parseFloat(style.getPropertyValue(`border-${name.toLowerCase()}-width`)) * PX;
    if (!width || kind === "none" || kind === "hidden") return;
    const color = style.getPropertyValue(`border-${name.toLowerCase()}-color`);
    const dash = kind === "dashed" ? [width * 3, width * 2] : kind === "dotted" ? [width, width] : undefined;
    // A linha passa pelo meio da borda. Numa caixa comum a borda fica dentro
    // dela; numa célula de tabela com bordas fundidas, a caixa já vai até o
    // meio da borda, e as duas células vizinhas desenham a mesma linha no
    // mesmo lugar (e não duas, lado a lado, que pareceriam uma linha grossa).
    const inset = collapsed ? 0 : width / 2;
    const dx = name === "Left" ? inset : name === "Right" ? -inset : 0;
    const dy = name === "Top" ? inset : name === "Bottom" ? -inset : 0;
    if (kind === "double") {
      const third = width / 3;
      const shift = (s: number) => [name === "Left" ? s : name === "Right" ? -s : 0, name === "Top" ? s : name === "Bottom" ? -s : 0];
      for (const s of [third / 2, width - third / 2]) {
        const [sx, sy] = shift(s);
        out.push({ kind: "line", x1: a[0] + sx, y1: a[1] + sy, x2: b[0] + sx, y2: b[1] + sy, width: third, color });
      }
      return;
    }
    out.push({ kind: "line", x1: a[0] + dx, y1: a[1] + dy, x2: b[0] + dx, y2: b[1] + dy, width, color, dash });
  };
  side("Top", [x0, y0], [x1, y0]);
  side("Bottom", [x0, y1], [x1, y1]);
  side("Left", [x0, y0], [x0, y1]);
  side("Right", [x1, y0], [x1, y1]);
}

type Edge = { width: number; color: string; style: string } | undefined;

/** Bordas centradas nas linhas da grade (as da célula de planilha). */
function gridEdges(out: Prim[], rect: DOMRect, edges: { top?: Edge; right?: Edge; bottom?: Edge; left?: Edge }, ox: number, oy: number) {
  const x0 = (rect.left - ox) * PX;
  const y0 = (rect.top - oy) * PX;
  const x1 = (rect.right - ox) * PX;
  const y1 = (rect.bottom - oy) * PX;
  const line = (e: Edge, a: [number, number], b: [number, number], vertical: boolean) => {
    if (!e || e.width <= 0) return;
    const dash = e.style === "dashed" ? [e.width * 3, e.width * 2] : e.style === "dotted" ? [e.width, e.width] : undefined;
    if (e.style === "double") {
      const third = e.width / 3;
      for (const s of [-third, third]) {
        const [dx, dy] = vertical ? [s, 0] : [0, s];
        out.push({ kind: "line", x1: a[0] + dx, y1: a[1] + dy, x2: b[0] + dx, y2: b[1] + dy, width: third, color: e.color });
      }
      return;
    }
    out.push({ kind: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], width: e.width, color: e.color, dash });
  };
  line(edges.top, [x0, y0], [x1, y0], false);
  line(edges.bottom, [x0, y1], [x1, y1], false);
  line(edges.left, [x0, y0], [x0, y1], true);
  line(edges.right, [x1, y0], [x1, y1], true);
}

/** Primitivas de tudo o que está dentro de `root`. */
export function collectPrims(root: HTMLElement, glyphs: GlyphCheck): Prim[] {
  const origin = root.getBoundingClientRect();
  const ox = origin.left;
  const oy = origin.top;
  const backgrounds: Prim[] = [];
  const borders: Prim[] = [];
  const images: Prim[] = [];
  const texts: Prim[] = [];
  const decorations: Prim[] = [];
  const links: Prim[] = [];

  const toRect = (r: DOMRect) => ({ x: (r.left - ox) * PX, y: (r.top - oy) * PX, w: r.width * PX, h: r.height * PX });

  // Caixas que cortam o que passa delas (texto de célula de planilha).
  const clipCache = new Map<Element, { left: number; right: number }>();
  const clipOf = (node: Element): { left: number; right: number } | null => {
    const box = node.closest('[data-clip="1"]');
    if (!box) return null;
    let c = clipCache.get(box);
    if (!c) {
      const r = box.getBoundingClientRect();
      c = { left: (r.left - ox) * PX, right: (r.right - ox) * PX };
      clipCache.set(box, c);
    }
    return c;
  };

  // A própria raiz conta: um objeto flutuante pode ser só uma imagem ou caixa.
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
    const bg = element.dataset.bg;
    if (bg && bg !== "auto") {
      const rects = element.tagName === "SPAN" ? Array.from(element.getClientRects()) : [element.getBoundingClientRect()];
      for (const r of rects) backgrounds.push({ kind: "rect", ...toRect(r), color: bg });
    }
    if (element.dataset.edges) {
      gridEdges(borders, element.getBoundingClientRect(), JSON.parse(element.dataset.edges), ox, oy);
    } else if (element.tagName === "TD" || element.dataset.borders === "1") {
      borderLines(borders, element.getBoundingClientRect(), getComputedStyle(element), ox, oy, element.tagName === "TD");
    }
    if (element.tagName === "IMG" && element.dataset.img !== undefined) {
      images.push({ kind: "image", ...toRect(element.getBoundingClientRect()), index: Number(element.dataset.img) });
    }
    if (element.classList.contains("box") && element.dataset.shape) {
      const r = toRect(element.getBoundingClientRect());
      backgrounds.push({
        kind: "shape", ...r, geometry: element.dataset.shape,
        fill: element.dataset.fill ?? null, stroke: element.dataset.stroke ?? null,
        strokeWidth: Number(element.dataset.strokeWidth ?? 0.75),
      });
    }
    if (element.dataset.watermark) {
      const w = JSON.parse(element.dataset.watermark) as { text: string; font: FontKey; color: string; opacity: number; rotation: number };
      backgrounds.push({
        kind: "watermark", ...toRect(element.getBoundingClientRect()), text: w.text,
        font: { key: w.font, bold: false, italic: false }, color: w.color, opacity: w.opacity, rotation: w.rotation,
      });
    }
    if (element.tagName === "A" && element.dataset.href) {
      for (const r of Array.from(element.getClientRects())) links.push({ kind: "link", ...toRect(r), url: element.dataset.href });
    }
    if (element.classList.contains("tab") && element.dataset.leader) {
      const r = element.getBoundingClientRect();
      const font = fontOf(element);
      const size = Number(element.dataset.size ?? 11);
      const char = element.dataset.leader === "hyphen" ? "-" : element.dataset.leader === "underscore" ? "_" : element.dataset.leader === "middleDot" ? "·" : ".";
      const advance = glyphs.advance(font, char, size);
      const width = r.width * PX - size * 0.15;
      const count = advance > 0 ? Math.floor(width / advance) : 0;
      if (count > 0) {
        const rect = toRect(r);
        texts.push({
          kind: "text",
          x: rect.x + rect.w - count * advance - size * 0.1,
          // A tabulação é uma caixa vazia: a base dela é a linha de base.
          y: (r.bottom - oy) * PX + paragraphShift(element.closest<HTMLElement>("div.pi") ?? element),
          size,
          text: char.repeat(count),
          font,
          color: element.dataset.color ?? "#000000",
        });
      }
    }
    // Sublinhado e tachado, por fragmento de linha do trecho.
    if (element.classList.contains("run") && (element.dataset.underline || element.dataset.strike)) {
      const size = Number(element.dataset.size ?? 11);
      const base = baselineOffset(element);
      const clip = clipOf(element);
      for (const r of Array.from(element.getClientRects())) {
        if (r.width < 0.5) continue;
        const x1 = Math.max((r.left - ox) * PX, clip?.left ?? -Infinity);
        const x2 = Math.min((r.right - ox) * PX, clip?.right ?? Infinity);
        if (x2 - x1 < 0.5) continue;
        const baseline = (r.top - oy) * PX + base;
        const color = element.dataset.color ?? "#000000";
        const thickness = Math.max(0.5, size * 0.055);
        if (element.dataset.underline) {
          const y = baseline + size * 0.11;
          const dash = element.dataset.underline === "dotted" ? [thickness, thickness * 1.5] : element.dataset.underline === "dashed" ? [size * 0.3, size * 0.2] : undefined;
          decorations.push({ kind: "line", x1, y1: y, x2, y2: y, width: thickness, color, dash });
          if (element.dataset.underline === "double") decorations.push({ kind: "line", x1, y1: y + thickness * 2, x2, y2: y + thickness * 2, width: thickness, color });
        }
        if (element.dataset.strike) {
          const y = baseline - size * 0.27;
          decorations.push({ kind: "line", x1, y1: y, x2, y2: y, width: thickness, color });
          if (element.dataset.strike === "2") decorations.push({ kind: "line", x1, y1: y - thickness * 2, x2, y2: y - thickness * 2, width: thickness, color });
        }
      }
    }
  }

  // Palavras de parágrafos justificados com espaço encolhido (ver
  // `styleRun`), para devolver o espaço normal à última linha.
  type Shrunk = { prim: Extract<Prim, { kind: "text" }>; right: number; shrink: number; space: number };
  const shrunk = new Map<HTMLElement, Shrunk[]>();

  // Texto: palavra por palavra, na posição medida.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const span = node.parentElement;
    if (!span || !span.classList.contains("run")) continue;
    const text = node.data;
    const font = fontOf(span);
    const size = Number(span.dataset.size ?? 11);
    const color = span.dataset.color ?? "#000000";
    const spacing = Number(span.dataset.spacing ?? 0) || undefined;
    const base = baselineOffset(span);
    const clip = clipOf(span);
    for (const m of text.matchAll(/[^\s\u200B]+/g)) {
      const start = m.index!;
      const word = m[0];
      // Partes da palavra por fonte: o que a fonte principal não desenha vai
      // para a fonte de símbolos, como o navegador fez ao montar a página.
      const segments: { from: number; to: number; font: FontRef }[] = [];
      let i = 0;
      for (const ch of word) {
        const f = glyphs.has(font, ch.codePointAt(0)!) ? font : SYMBOLS;
        const last = segments[segments.length - 1];
        if (last && last.font === f) last.to = i + ch.length;
        else segments.push({ from: i, to: i + ch.length, font: f });
        i += ch.length;
      }
      for (const seg of segments) {
        range.setStart(node, start + seg.from);
        range.setEnd(node, start + seg.to);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
        const whole = rects[0] ?? range.getBoundingClientRect();
        const cut = clip !== null && rects.length <= 1 &&
          ((whole.left - ox) * PX < clip.left - 0.01 || (whole.right - ox) * PX > clip.right + 0.01);
        if (cut && ((whole.right - ox) * PX <= clip!.left || (whole.left - ox) * PX >= clip!.right)) continue;
        if (rects.length <= 1 && !cut) {
          const r = rects[0] ?? range.getBoundingClientRect();
          const prim: Extract<Prim, { kind: "text" }> = {
            kind: "text",
            x: (r.left - ox) * PX,
            y: (r.top - oy) * PX + base,
            size,
            text: word.slice(seg.from, seg.to),
            font: seg.font,
            color,
            spacing,
          };
          texts.push(prim);
          if (span.dataset.shrink) {
            const para = span.closest<HTMLElement>("div.pi");
            if (para) {
              const list = shrunk.get(para) ?? [];
              list.push({ prim, right: (r.right - ox) * PX, shrink: Number(span.dataset.shrink), space: Number(span.dataset.space) });
              shrunk.set(para, list);
            }
          }
          continue;
        }
        // Palavra partida entre linhas (endereço longo, hifenização) ou cortada
        // na borda da célula: letra a letra.
        for (let k = seg.from; k < seg.to; k++) {
          range.setStart(node, start + k);
          range.setEnd(node, start + k + 1);
          const r = range.getBoundingClientRect();
          if (r.width <= 0) continue;
          if (clip) {
            const mid = ((r.left + r.right) / 2 - ox) * PX;
            if (mid < clip.left || mid > clip.right) continue;
          }
          texts.push({ kind: "text", x: (r.left - ox) * PX, y: (r.top - oy) * PX + base, size, text: word[k], font: seg.font, color, spacing });
        }
      }
    }
  }

  // Última linha dos parágrafos justificados: o Word não a justifica, e os
  // espaços dela ficam com a largura normal.
  for (const [para, list] of shrunk) {
    const lines = linesOf(para, oy);
    const last = lines[lines.length - 1];
    if (!last) continue;
    const onLast = list.filter((e) => e.prim.y >= last.top - 0.5 && e.prim.y <= last.bottom + 0.5).sort((a, b) => a.prim.x - b.prim.x);
    if (onLast.length < 2) continue;
    const shifts = [0];
    let total = 0;
    for (let i = 1; i < onLast.length; i++) {
      const prev = onLast[i - 1];
      const gap = onLast[i].prim.x - prev.right;
      const narrow = prev.space - prev.shrink;
      const spaces = gap > 0.05 && narrow > 0 ? Math.max(1, Math.round(gap / narrow)) : 0;
      total += spaces * prev.shrink;
      shifts.push(total);
    }
    const style = getComputedStyle(para);
    const box = para.getBoundingClientRect();
    const right = (box.right - ox) * PX - (parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth)) * PX;
    const room = right - onLast[onLast.length - 1].right;
    const scale = total > room ? Math.max(0, room) / total : 1;
    onLast.forEach((e, i) => (e.prim.x += shifts[i] * scale));
  }

  return [...backgrounds, ...borders, ...images, ...texts, ...decorations, ...links];
}
