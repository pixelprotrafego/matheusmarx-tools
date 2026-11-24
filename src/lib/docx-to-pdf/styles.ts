/**
 * Estilos do Word e a ordem em que se sobrepõem.
 *
 * Uma propriedade de texto vem, do mais fraco ao mais forte, de: padrões do
 * documento → estilo da tabela → cadeia de estilos do parágrafo (`basedOn`) →
 * estilo de caractere → formatação direta. Os módulos de leitura aplicam
 * "remendos" nessa ordem; o último a dizer algo ganha.
 */

import type { Border, ParaProps, RunProps, TabStop } from "./model";
import { attr, kid, kids, num, onOff, path, twip, val } from "./xml";

export type RunPatch = Partial<RunProps>;
export type ParaPatch = Partial<Omit<ParaProps, "markProps" | "tabs" | "borders">> & {
  tabs?: TabStop[];
  borders?: ParaProps["borders"];
  numId?: string | null;
  ilvl?: number | null;
};

interface RawStyle {
  id: string;
  type: string;
  basedOn: string | null;
  pPr: Element | null;
  rPr: Element | null;
  tblPr: Element | null;
  tcPr: Element | null;
  conditional: Map<string, { pPr: Element | null; rPr: Element | null; tcPr: Element | null }>;
}

export interface Theme {
  majorFont: string;
  minorFont: string;
  colors: Map<string, string>;
}

const HIGHLIGHT: Record<string, string> = {
  yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", magenta: "#FF00FF", blue: "#0000FF", red: "#FF0000",
  darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000",
  darkYellow: "#808000", darkGray: "#808080", lightGray: "#C0C0C0", black: "#000000", white: "#FFFFFF",
};

const THEME_COLOR_ALIAS: Record<string, string> = {
  text1: "dk1", background1: "lt1", text2: "dk2", background2: "lt2",
  dark1: "dk1", light1: "lt1", dark2: "dk2", light2: "lt2",
  hyperlink: "hlink", followedHyperlink: "folHlink",
};

export function readTheme(doc: Document | null): Theme {
  const theme: Theme = { majorFont: "Calibri Light", minorFont: "Calibri", colors: new Map() };
  if (!doc) return theme;
  const all = Array.from(doc.getElementsByTagName("*"));
  const major = all.find((e) => e.localName === "majorFont");
  const minor = all.find((e) => e.localName === "minorFont");
  theme.majorFont = attr(kid(major, "latin"), "typeface") || theme.majorFont;
  theme.minorFont = attr(kid(minor, "latin"), "typeface") || theme.minorFont;
  const scheme = all.find((e) => e.localName === "clrScheme");
  for (const c of kids(scheme)) {
    const srgb = kid(c, "srgbClr");
    const sys = kid(c, "sysClr");
    const value = attr(srgb, "val") ?? attr(sys, "lastClr");
    if (value) theme.colors.set(c.localName, `#${value.toUpperCase()}`);
  }
  return theme;
}

/** Cor do tema com escurecimento (shade) ou clareamento (tint) do Word. */
function themeColor(theme: Theme, name: string, shade: string | null, tint: string | null): string | null {
  const base = theme.colors.get(THEME_COLOR_ALIAS[name] ?? name);
  if (!base) return null;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16));
  if (shade) {
    const s = parseInt(shade, 16) / 255;
    [r, g, b] = [r, g, b].map((c) => c * s);
  }
  if (tint) {
    const t = parseInt(tint, 16) / 255;
    [r, g, b] = [r, g, b].map((c) => c + (255 - c) * (1 - t));
  }
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** Cor de um elemento com `w:val`/`w:themeColor` (ou `w:fill`/`w:themeFill`). */
export function colorOf(theme: Theme, el: Element | null, valueAttr = "val", themeAttr = "themeColor"): string | null | undefined {
  if (!el) return undefined;
  const themed = attr(el, themeAttr);
  if (themed) {
    const shadeAttr = themeAttr === "themeFill" ? "themeFillShade" : "themeShade";
    const tintAttr = themeAttr === "themeFill" ? "themeFillTint" : "themeTint";
    const c = themeColor(theme, themed, attr(el, shadeAttr), attr(el, tintAttr));
    if (c) return c;
  }
  const v = attr(el, valueAttr);
  if (!v || v === "auto") return null;
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toUpperCase()}` : null;
}

const fontOf = (theme: Theme, rFonts: Element | null): string | undefined => {
  if (!rFonts) return undefined;
  const themed = attr(rFonts, "asciiTheme") ?? attr(rFonts, "hAnsiTheme");
  if (themed) return themed.startsWith("major") ? theme.majorFont : theme.minorFont;
  return attr(rFonts, "ascii") ?? attr(rFonts, "hAnsi") ?? attr(rFonts, "cs") ?? attr(rFonts, "eastAsia") ?? undefined;
};

/** Lê as propriedades de texto (`w:rPr`) como remendo. */
export function readRun(theme: Theme, rPr: Element | null): RunPatch {
  const p: RunPatch = {};
  if (!rPr) return p;
  const font = fontOf(theme, kid(rPr, "rFonts"));
  if (font) p.font = font;
  const sz = num(kid(rPr, "sz"), "val");
  if (sz !== null) p.size = sz / 2;
  const b = onOff(rPr, "b");
  if (b !== null) p.bold = b;
  const i = onOff(rPr, "i");
  if (i !== null) p.italic = i;
  const u = kid(rPr, "u");
  if (u) {
    const v = attr(u, "val") ?? "single";
    p.underline =
      v === "none" ? null
      : v === "double" ? "double"
      : v.startsWith("dot") ? "dotted"
      : v.startsWith("dash") ? "dashed"
      : v.startsWith("wav") ? "wave"
      : "single";
  }
  const strike = onOff(rPr, "strike");
  if (strike !== null) p.strike = strike;
  const dstrike = onOff(rPr, "dstrike");
  if (dstrike !== null) p.doubleStrike = dstrike;
  const color = colorOf(theme, kid(rPr, "color"));
  if (color !== undefined) p.color = color;
  const hl = val(rPr, "highlight");
  if (hl) p.highlight = hl === "none" ? null : HIGHLIGHT[hl] ?? null;
  const shd = kid(rPr, "shd");
  if (shd) {
    const fill = colorOf(theme, shd, "fill", "themeFill");
    if (fill !== undefined) p.shading = fill;
  }
  const va = val(rPr, "vertAlign");
  if (va) p.vertAlign = va === "superscript" ? "superscript" : va === "subscript" ? "subscript" : null;
  const caps = onOff(rPr, "caps");
  if (caps !== null) p.caps = caps;
  const small = onOff(rPr, "smallCaps");
  if (small !== null) p.smallCaps = small;
  const vanish = onOff(rPr, "vanish");
  if (vanish !== null) p.hidden = vanish;
  const spacing = num(kid(rPr, "spacing"), "val");
  if (spacing !== null) p.spacing = spacing / 20;
  const position = num(kid(rPr, "position"), "val");
  if (position !== null) p.position = position / 2;
  return p;
}

const BORDER_STYLE: Record<string, Border["style"]> = {
  double: "double", dotted: "dotted", dashed: "dashed", dashSmallGap: "dashed", dotDash: "dashed", dotDotDash: "dashed",
};

/** Borda do Word (`w:top`, `w:left`…) em pontos; `null` = sem borda declarada como nula. */
export function readBorder(theme: Theme, el: Element | null): Border | null | undefined {
  if (!el) return undefined;
  const v = attr(el, "val") ?? "single";
  if (v === "nil" || v === "none") return null;
  const sz = num(el, "sz") ?? 4;
  return {
    width: Math.max(0.25, sz / 8),
    // A cor da borda fica em `w:color` (o `w:val` é o tipo de linha).
    color: colorOf(theme, el, "color", "themeColor") ?? "#000000",
    style: BORDER_STYLE[v] ?? "solid",
    space: num(el, "space") ?? 0,
  };
}

/** Lê as propriedades de parágrafo (`w:pPr`) como remendo. */
export function readPara(theme: Theme, pPr: Element | null): ParaPatch {
  const p: ParaPatch = {};
  if (!pPr) return p;
  const jc = val(pPr, "jc");
  if (jc) {
    p.align =
      jc === "center" ? "center"
      : jc === "right" || jc === "end" ? "right"
      : jc === "both" || jc === "distribute" || jc === "justify" || jc.endsWith("Kashida") ? "justify"
      : "left";
  }
  const ind = kid(pPr, "ind");
  if (ind) {
    const left = twip(num(ind, "left") ?? num(ind, "start"));
    const right = twip(num(ind, "right") ?? num(ind, "end"));
    const first = twip(num(ind, "firstLine"));
    const hanging = twip(num(ind, "hanging"));
    if (left !== null) p.indLeft = left;
    if (right !== null) p.indRight = right;
    if (hanging !== null) p.indFirst = -hanging;
    else if (first !== null) p.indFirst = first;
  }
  const sp = kid(pPr, "spacing");
  if (sp) {
    const before = twip(num(sp, "before"));
    const after = twip(num(sp, "after"));
    if (before !== null) p.spaceBefore = before;
    if (after !== null) p.spaceAfter = after;
    // Espaçamento automático (documentos vindos de HTML): 14 pt.
    const isOn = (v: string | null) => v === "1" || v === "true" || v === "on";
    if (isOn(attr(sp, "beforeAutospacing"))) p.spaceBefore = 14;
    if (isOn(attr(sp, "afterAutospacing"))) p.spaceAfter = 14;
    const line = num(sp, "line");
    const rule = attr(sp, "lineRule");
    if (line !== null) {
      p.lineRule = rule === "exact" ? "exact" : rule === "atLeast" ? "atLeast" : "auto";
      p.line = p.lineRule === "auto" ? line / 240 : line / 20;
    }
  }
  const contextual = onOff(pPr, "contextualSpacing");
  if (contextual !== null) p.contextual = contextual;
  const keepNext = onOff(pPr, "keepNext");
  if (keepNext !== null) p.keepNext = keepNext;
  const keepLines = onOff(pPr, "keepLines");
  if (keepLines !== null) p.keepLines = keepLines;
  const pbb = onOff(pPr, "pageBreakBefore");
  if (pbb !== null) p.pageBreakBefore = pbb;
  const widow = onOff(pPr, "widowControl");
  if (widow !== null) p.widowControl = widow;
  const numPr = kid(pPr, "numPr");
  if (numPr) {
    p.numId = val(numPr, "numId");
    const ilvl = num(kid(numPr, "ilvl"), "val");
    p.ilvl = ilvl ?? 0;
  }
  const tabs = kid(pPr, "tabs");
  if (tabs) {
    p.tabs = kids(tabs, "tab").map((t) => ({
      pos: (num(t, "pos") ?? 0) / 20,
      align: ((): TabStop["align"] => {
        const v = attr(t, "val") ?? "left";
        if (v === "clear") return "clear";
        if (v === "center") return "center";
        if (v === "right" || v === "end") return "right";
        if (v === "decimal") return "decimal";
        if (v === "bar") return "bar";
        return "left";
      })(),
      leader: ((): TabStop["leader"] => {
        const l = attr(t, "leader") ?? "none";
        return l === "dot" ? "dot" : l === "hyphen" ? "hyphen" : l === "underscore" || l === "heavy" ? "underscore" : l === "middleDot" ? "middleDot" : "none";
      })(),
    }));
  }
  const shd = kid(pPr, "shd");
  if (shd) {
    const fill = colorOf(theme, shd, "fill", "themeFill");
    if (fill !== undefined) p.shading = fill;
  }
  const pBdr = kid(pPr, "pBdr");
  if (pBdr) {
    const borders: ParaProps["borders"] = {};
    for (const side of ["top", "bottom", "left", "right", "between"] as const) {
      const b = readBorder(theme, kid(pBdr, side));
      if (b) borders[side] = b;
    }
    p.borders = borders;
  }
  return p;
}

/** Junta as paradas de tabulação, aplicando as remoções (`clear`). */
export function mergeTabs(base: TabStop[], add: TabStop[]): TabStop[] {
  const out = base.filter((t) => !add.some((a) => Math.abs(a.pos - t.pos) < 0.5));
  for (const a of add) if (a.align !== "clear") out.push(a);
  return out.sort((a, b) => a.pos - b.pos);
}

export class StyleSheet {
  readonly theme: Theme;
  private readonly styles = new Map<string, RawStyle>();
  readonly defaultParagraph: string | null;
  readonly defaultCharacter: string | null;
  readonly defaultTable: string | null;
  readonly docRPr: Element | null;
  readonly docPPr: Element | null;

  constructor(stylesDoc: Document | null, theme: Theme) {
    this.theme = theme;
    const root = stylesDoc?.documentElement ?? null;
    this.docRPr = path(root, "docDefaults", "rPrDefault", "rPr");
    this.docPPr = path(root, "docDefaults", "pPrDefault", "pPr");
    let defaultParagraph: string | null = null;
    let defaultCharacter: string | null = null;
    let defaultTable: string | null = null;
    for (const s of kids(root, "style")) {
      const id = attr(s, "styleId");
      if (!id) continue;
      const type = attr(s, "type") ?? "paragraph";
      const conditional = new Map<string, { pPr: Element | null; rPr: Element | null; tcPr: Element | null }>();
      for (const c of kids(s, "tblStylePr")) {
        const t = attr(c, "type");
        if (t) conditional.set(t, { pPr: kid(c, "pPr"), rPr: kid(c, "rPr"), tcPr: kid(c, "tcPr") });
      }
      this.styles.set(id, {
        id,
        type,
        basedOn: val(s, "basedOn"),
        pPr: kid(s, "pPr"),
        rPr: kid(s, "rPr"),
        tblPr: kid(s, "tblPr"),
        tcPr: kid(s, "tcPr"),
        conditional,
      });
      const isDefault = attr(s, "default") === "1" || attr(s, "default") === "true";
      if (isDefault && type === "paragraph") defaultParagraph = id;
      if (isDefault && type === "character") defaultCharacter = id;
      if (isDefault && type === "table") defaultTable = id;
    }
    this.defaultParagraph = defaultParagraph;
    this.defaultCharacter = defaultCharacter;
    this.defaultTable = defaultTable;
  }

  /** Cadeia de um estilo, da base para o próprio estilo. */
  chain(id: string | null): RawStyle[] {
    const out: RawStyle[] = [];
    const seen = new Set<string>();
    let current = id ? this.styles.get(id) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      out.unshift(current);
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }
    return out;
  }

  has(id: string | null): boolean {
    return id !== null && this.styles.has(id);
  }

  /** Remendos de parágrafo e de texto de um estilo de parágrafo (com herança). */
  paragraphStyle(id: string | null): { para: ParaPatch[]; run: RunPatch[] } {
    const chain = this.chain(this.has(id) ? id : this.defaultParagraph);
    return {
      para: chain.map((s) => readPara(this.theme, s.pPr)),
      run: chain.map((s) => readRun(this.theme, s.rPr)),
    };
  }

  /** Remendos de texto de um estilo de caractere (com herança). */
  characterStyle(id: string | null): RunPatch[] {
    if (!id) return [];
    return this.chain(id).map((s) => readRun(this.theme, s.rPr));
  }

  /** Estilo de tabela: propriedades gerais e condicionais. */
  tableStyle(id: string | null) {
    return this.chain(this.has(id) ? id : this.defaultTable);
  }
}

export const DEFAULT_RUN: RunProps = {
  font: "Times New Roman",
  size: 10,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  doubleStrike: false,
  color: null,
  highlight: null,
  shading: null,
  vertAlign: null,
  caps: false,
  smallCaps: false,
  hidden: false,
  spacing: 0,
  position: 0,
};

export function applyRun(patches: RunPatch[]): RunProps {
  const out: RunProps = { ...DEFAULT_RUN };
  for (const p of patches) Object.assign(out, p);
  return out;
}
