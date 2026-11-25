/**
 * Leitura de uma pasta de trabalho .xlsx: o que a impressão do Excel usa.
 *
 * Valores e textos formatados vêm do SheetJS (que aplica os formatos de
 * número); aparência e página vêm daqui, direto do XML, porque a edição livre
 * do SheetJS não lê fontes, preenchimentos nem bordas.
 */

import type JSZip from "jszip";
import { attr, kid, kids, num, parseXml } from "../docx-to-pdf/xml";

export interface XFont {
  name: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: "single" | "double" | null;
  strike: boolean;
  color: string | null;
  vertAlign: "superscript" | "subscript" | null;
}

export interface XBorderSide {
  style: string;
  color: string | null;
}

export interface XStyle {
  font: XFont;
  fill: string | null;
  border: { left?: XBorderSide; right?: XBorderSide; top?: XBorderSide; bottom?: XBorderSide };
  horizontal: string;
  vertical: string;
  wrap: boolean;
  shrink: boolean;
  indent: number;
  numFmtId: number;
  numFmt: string;
}

export interface XRun {
  text: string;
  font: XFont;
}

export interface XCell {
  row: number;
  col: number;
  /** Tipo do Excel: número, texto, booleano, erro. Datas são números. */
  type: "n" | "s" | "b" | "e";
  value: number | string | boolean | null;
  /** Texto com partes de formatação diferente (texto rico). */
  runs: XRun[] | null;
  style: number;
}

export interface XRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface XSheet {
  name: string;
  index: number;
  hidden: boolean;
  /** Células por linha e coluna (base 0). */
  cells: Map<number, Map<number, XCell>>;
  rows: Map<number, { height: number | null; custom: boolean; hidden: boolean; style: number | null; descent: number | null }>;
  cols: { min: number; max: number; width: number | null; hidden: boolean; style: number | null }[];
  merges: XRange[];
  defaultRowHeight: number | null;
  /** `x14ac:dyDescent` da planilha: o Excel soma à altura da linha na impressão. */
  descent: number;
  defaultColWidth: number | null;
  baseColWidth: number;
  page: {
    orientation: "portrait" | "landscape";
    paperSize: number | null;
    scale: number;
    fitToPage: boolean;
    fitToWidth: number;
    fitToHeight: number;
    firstPageNumber: number | null;
    pageOrder: "downThenOver" | "overThenDown";
  };
  margins: { left: number; right: number; top: number; bottom: number; header: number; footer: number };
  gridLines: boolean;
  centerH: boolean;
  centerV: boolean;
  header: string | null;
  footer: string | null;
  firstHeader: string | null;
  firstFooter: string | null;
  differentFirst: boolean;
  rowBreaks: number[];
  colBreaks: number[];
  printArea: XRange | null;
  printTitleRows: [number, number] | null;
}

export interface XWorkbook {
  sheets: XSheet[];
  styles: XStyle[];
  defaultFont: XFont;
  date1904: boolean;
}

// ------------------------------------------------------------------ cores

/** Paleta indexada clássica do Excel (índices 0 a 63). */
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** Ordem dos índices de tema do Excel (claro e escuro trocados em relação ao XML do tema). */
const THEME_ORDER = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

/** Clareia (tint > 0) ou escurece (tint < 0) como o Excel: pela luminância em HLS. */
export function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue(p, q, h + 1 / 3);
    g = hue(p, q, h);
    b = hue(p, q, h - 1 / 3);
  }
  const hx = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`.toUpperCase();
}

function colorOf(el: Element | null, theme: string[]): string | null {
  if (!el) return null;
  if (attr(el, "auto") === "1" || attr(el, "auto") === "true") return null;
  const tint = Number(attr(el, "tint") ?? 0);
  let base: string | null = null;
  const rgb = attr(el, "rgb");
  const th = attr(el, "theme");
  const idx = attr(el, "indexed");
  if (rgb && /^[0-9A-Fa-f]{6,8}$/.test(rgb)) base = `#${rgb.slice(-6).toUpperCase()}`;
  else if (th !== null && theme[Number(th)]) base = theme[Number(th)];
  else if (idx !== null) {
    const i = Number(idx);
    if (i === 64 || i === 65) return null; // cor do sistema (texto/fundo automáticos)
    if (INDEXED[i]) base = `#${INDEXED[i]}`;
  }
  return base ? applyTint(base, tint) : null;
}

// ------------------------------------------------------------------ estilos

/** Formatos de número embutidos que o arquivo não grava por extenso. */
const BUILTIN_FORMATS: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00",
  12: "# ?/?", 13: "# ??/??", 14: "m/d/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yyyy h:mm", 37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss",
  46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
};

function readFont(el: Element | null, theme: string[], base?: XFont): XFont {
  const font: XFont = base
    ? { ...base }
    : { name: "Calibri", size: 11, bold: false, italic: false, underline: null, strike: false, color: null, vertAlign: null };
  if (!el) return font;
  const flag = (name: string) => {
    const k = kid(el, name);
    if (!k) return null;
    const v = attr(k, "val");
    return v === null || !(v === "0" || v === "false");
  };
  const name = attr(kid(el, "name") ?? kid(el, "rFont"), "val");
  if (name) font.name = name;
  const size = num(kid(el, "sz"), "val");
  if (size) font.size = size;
  const b = flag("b");
  if (b !== null) font.bold = b;
  const i = flag("i");
  if (i !== null) font.italic = i;
  const s = flag("strike");
  if (s !== null) font.strike = s;
  const u = kid(el, "u");
  if (u) {
    const v = attr(u, "val") ?? "single";
    font.underline = v === "none" ? null : v.startsWith("double") ? "double" : "single";
  }
  const va = attr(kid(el, "vertAlign"), "val");
  if (va === "superscript" || va === "subscript") font.vertAlign = va;
  const color = kid(el, "color");
  if (color) font.color = colorOf(color, theme);
  return font;
}

function readStyles(doc: Document | null, theme: string[]): { styles: XStyle[]; defaultFont: XFont } {
  const root = doc?.documentElement ?? null;
  const formats = new Map<number, string>();
  for (const f of kids(kid(root, "numFmts"), "numFmt")) formats.set(Number(attr(f, "numFmtId")), attr(f, "formatCode") ?? "General");
  const fonts = kids(kid(root, "fonts"), "font").map((f) => readFont(f, theme));
  const defaultFont = fonts[0] ?? readFont(null, theme);
  const fills = kids(kid(root, "fills"), "fill").map((f) => {
    const pattern = kid(f, "patternFill");
    if (pattern) {
      const type = attr(pattern, "patternType") ?? (kid(pattern, "fgColor") ? "solid" : "none");
      if (type === "none") return null;
      return colorOf(kid(pattern, "fgColor"), theme) ?? colorOf(kid(pattern, "bgColor"), theme);
    }
    const gradient = kid(f, "gradientFill");
    if (gradient) return colorOf(kid(kid(gradient, "stop"), "color"), theme);
    return null;
  });
  const borders = kids(kid(root, "borders"), "border").map((b) => {
    const side = (name: string): XBorderSide | undefined => {
      const el = kid(b, name) ?? (name === "left" ? kid(b, "start") : name === "right" ? kid(b, "end") : null);
      const style = attr(el, "style");
      if (!el || !style || style === "none") return undefined;
      return { style, color: colorOf(kid(el, "color"), theme) };
    };
    return { left: side("left"), right: side("right"), top: side("top"), bottom: side("bottom") };
  });
  const styles = kids(kid(root, "cellXfs"), "xf").map((xf): XStyle => {
    const a = kid(xf, "alignment");
    const numFmtId = Number(attr(xf, "numFmtId") ?? 0);
    return {
      font: fonts[Number(attr(xf, "fontId") ?? 0)] ?? defaultFont,
      fill: fills[Number(attr(xf, "fillId") ?? 0)] ?? null,
      border: borders[Number(attr(xf, "borderId") ?? 0)] ?? {},
      horizontal: attr(a, "horizontal") ?? "general",
      vertical: attr(a, "vertical") ?? "bottom",
      wrap: attr(a, "wrapText") === "1" || attr(a, "wrapText") === "true",
      shrink: attr(a, "shrinkToFit") === "1" || attr(a, "shrinkToFit") === "true",
      indent: Number(attr(a, "indent") ?? 0),
      numFmtId,
      numFmt: formats.get(numFmtId) ?? BUILTIN_FORMATS[numFmtId] ?? "General",
    };
  });
  if (!styles.length) {
    styles.push({
      font: defaultFont, fill: null, border: {}, horizontal: "general", vertical: "bottom",
      wrap: false, shrink: false, indent: 0, numFmtId: 0, numFmt: "General",
    });
  }
  return { styles, defaultFont };
}

// ------------------------------------------------------------------ planilha

/** "B3" -> { row: 2, col: 1 } (base 0). */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

export function parseRange(ref: string): XRange | null {
  const [a, b] = ref.replace(/'[^']*'!|[^!]*!/, "").split(":");
  const p = parseRef(a);
  const q = parseRef(b ?? a);
  if (!p || !q) return null;
  return { r1: Math.min(p.row, q.row), c1: Math.min(p.col, q.col), r2: Math.max(p.row, q.row), c2: Math.max(p.col, q.col) };
}

export function colName(col: number): string {
  let s = "";
  let n = col + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function readRich(si: Element, theme: string[], base: XFont): { text: string; runs: XRun[] | null } {
  const runs = kids(si, "r");
  if (!runs.length) return { text: kids(si, "t").map((t) => t.textContent ?? "").join(""), runs: null };
  const out = runs.map((r) => ({ text: kid(r, "t")?.textContent ?? "", font: readFont(kid(r, "rPr"), theme, base) }));
  return { text: out.map((r) => r.text).join(""), runs: out };
}

const onOffAttr = (v: string | null) => v === "1" || v === "true";

function readSheet(
  doc: Document,
  name: string,
  index: number,
  hidden: boolean,
  strings: { text: string; rich: Element | null }[],
  theme: string[],
  styles: XStyle[],
): XSheet {
  const root = doc.documentElement;
  const cells = new Map<number, Map<number, XCell>>();
  const rows: XSheet["rows"] = new Map();
  const data = kid(root, "sheetData");
  let nextRow = 0;
  for (const rowEl of kids(data, "row")) {
    const r = attr(rowEl, "r") !== null ? Number(attr(rowEl, "r")) - 1 : nextRow;
    nextRow = r + 1;
    const ht = num(rowEl, "ht");
    rows.set(r, {
      height: ht,
      custom: onOffAttr(attr(rowEl, "customHeight")),
      hidden: onOffAttr(attr(rowEl, "hidden")),
      style: onOffAttr(attr(rowEl, "customFormat")) ? Number(attr(rowEl, "s") ?? 0) : null,
      descent: num(rowEl, "dyDescent"),
    });
    let nextCol = 0;
    for (const c of kids(rowEl, "c")) {
      const ref = attr(c, "r");
      const pos = ref ? parseRef(ref) : { row: r, col: nextCol };
      if (!pos) continue;
      nextCol = pos.col + 1;
      const t = attr(c, "t") ?? "n";
      const style = Number(attr(c, "s") ?? 0);
      const v = kid(c, "v")?.textContent ?? null;
      let cell: XCell;
      const font = (styles[style] ?? styles[0]).font;
      if (t === "s") {
        const entry = strings[Number(v)];
        const rich = entry?.rich ? readRich(entry.rich, theme, font) : null;
        cell = { row: pos.row, col: pos.col, type: "s", value: entry?.text ?? "", runs: rich?.runs ?? null, style };
      } else if (t === "inlineStr") {
        const is = kid(c, "is");
        const rich = is ? readRich(is, theme, font) : { text: "", runs: null };
        cell = { row: pos.row, col: pos.col, type: "s", value: rich.text, runs: rich.runs, style };
      } else if (t === "str") {
        cell = { row: pos.row, col: pos.col, type: "s", value: v ?? "", runs: null, style };
      } else if (t === "b") {
        cell = { row: pos.row, col: pos.col, type: "b", value: v === "1", runs: null, style };
      } else if (t === "e") {
        cell = { row: pos.row, col: pos.col, type: "e", value: v ?? "#N/A", runs: null, style };
      } else if (t === "d") {
        // Data ISO: vira o número de série do Excel (dias desde 30/12/1899).
        const ms = v === null ? NaN : Date.parse(v);
        cell = { row: pos.row, col: pos.col, type: "n", value: Number.isNaN(ms) ? null : ms / 86400000 + 25569, runs: null, style };
      } else {
        cell = { row: pos.row, col: pos.col, type: "n", value: v === null ? null : Number(v), runs: null, style };
      }
      let line = cells.get(pos.row);
      if (!line) cells.set(pos.row, (line = new Map()));
      line.set(pos.col, cell);
    }
  }

  const cols = kids(kid(root, "cols"), "col").map((c) => ({
    min: Number(attr(c, "min")) - 1,
    max: Number(attr(c, "max")) - 1,
    width: num(c, "width"),
    hidden: onOffAttr(attr(c, "hidden")),
    style: attr(c, "style") !== null ? Number(attr(c, "style")) : null,
  }));
  const merges = kids(kid(root, "mergeCells"), "mergeCell").map((m) => parseRange(attr(m, "ref") ?? "")).filter((m): m is XRange => m !== null);
  const fmt = kid(root, "sheetFormatPr");
  const setup = kid(root, "pageSetup");
  const fitToPage = onOffAttr(attr(kid(kid(root, "sheetPr"), "pageSetUpPr"), "fitToPage"));
  const pm = kid(root, "pageMargins");
  const po = kid(root, "printOptions");
  const hf = kid(root, "headerFooter");
  const breaks = (el: Element | null) => kids(el, "brk").map((b) => Number(attr(b, "id") ?? 0)).filter((n) => n > 0);

  return {
    name,
    index,
    hidden,
    cells,
    rows,
    cols,
    merges,
    defaultRowHeight: num(fmt, "defaultRowHeight"),
    descent: num(fmt, "dyDescent") ?? 0,
    defaultColWidth: num(fmt, "defaultColWidth"),
    baseColWidth: num(fmt, "baseColWidth") ?? 8,
    page: {
      orientation: attr(setup, "orientation") === "landscape" ? "landscape" : "portrait",
      paperSize: num(setup, "paperSize"),
      scale: num(setup, "scale") ?? 100,
      fitToPage,
      fitToWidth: num(setup, "fitToWidth") ?? 1,
      fitToHeight: num(setup, "fitToHeight") ?? 1,
      firstPageNumber: onOffAttr(attr(setup, "useFirstPageNumber")) ? num(setup, "firstPageNumber") : null,
      pageOrder: attr(setup, "pageOrder") === "overThenDown" ? "overThenDown" : "downThenOver",
    },
    margins: {
      left: num(pm, "left") ?? 0.7,
      right: num(pm, "right") ?? 0.7,
      top: num(pm, "top") ?? 0.75,
      bottom: num(pm, "bottom") ?? 0.75,
      header: num(pm, "header") ?? 0.3,
      footer: num(pm, "footer") ?? 0.3,
    },
    gridLines: onOffAttr(attr(po, "gridLines")),
    centerH: onOffAttr(attr(po, "horizontalCentered")),
    centerV: onOffAttr(attr(po, "verticalCentered")),
    header: kid(hf, "oddHeader")?.textContent ?? null,
    footer: kid(hf, "oddFooter")?.textContent ?? null,
    firstHeader: kid(hf, "firstHeader")?.textContent ?? null,
    firstFooter: kid(hf, "firstFooter")?.textContent ?? null,
    differentFirst: onOffAttr(attr(hf, "differentFirst")),
    rowBreaks: breaks(kid(root, "rowBreaks")),
    colBreaks: breaks(kid(root, "colBreaks")),
    printArea: null,
    printTitleRows: null,
  };
}

/** Caminho de uma parte relativa à pasta `xl/`. */
const resolveTarget = (target: string) => (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);

export async function readWorkbook(zip: JSZip): Promise<XWorkbook> {
  const xml = async (name: string) => {
    const f = zip.file(name);
    return f ? parseXml(await f.async("string")) : null;
  };
  const wb = await xml("xl/workbook.xml");
  if (!wb) throw new Error("Este arquivo não é uma planilha Excel (.xlsx) válida.");
  const rels = await xml("xl/_rels/workbook.xml.rels");
  const relMap = new Map<string, { target: string; type: string }>();
  for (const r of kids(rels?.documentElement, "Relationship")) {
    relMap.set(attr(r, "Id") ?? "", { target: attr(r, "Target") ?? "", type: attr(r, "Type") ?? "" });
  }
  const partOfType = (suffix: string) => [...relMap.values()].find((r) => r.type.endsWith(suffix))?.target;

  // Tema: a ordem do Excel troca claro e escuro.
  const themeDoc = await xml(resolveTarget(partOfType("/theme") ?? "theme/theme1.xml"));
  const scheme = themeDoc ? Array.from(themeDoc.getElementsByTagName("*")).find((e) => e.localName === "clrScheme") : null;
  const schemeColors = new Map<string, string>();
  for (const c of kids(scheme)) {
    const value = attr(kid(c, "srgbClr"), "val") ?? attr(kid(c, "sysClr"), "lastClr");
    if (value) schemeColors.set(c.localName, `#${value.toUpperCase()}`);
  }
  const theme = THEME_ORDER.map((n) => schemeColors.get(n) ?? (n === "lt1" ? "#FFFFFF" : "#000000"));

  const { styles, defaultFont } = readStyles(await xml(resolveTarget(partOfType("/styles") ?? "styles.xml")), theme);

  const sstDoc = await xml(resolveTarget(partOfType("/sharedStrings") ?? "sharedStrings.xml"));
  const strings = kids(sstDoc?.documentElement, "si").map((si) => ({
    text: kids(si, "r").length
      ? kids(si, "r").map((r) => kid(r, "t")?.textContent ?? "").join("")
      : kids(si, "t").map((t) => t.textContent ?? "").join(""),
    rich: kids(si, "r").length ? si : null,
  }));

  const root = wb.documentElement;
  const date1904 = onOffAttr(attr(kid(root, "workbookPr"), "date1904"));
  const sheetEls = kids(kid(root, "sheets"), "sheet");
  const sheets: XSheet[] = [];
  for (let i = 0; i < sheetEls.length; i++) {
    const s = sheetEls[i];
    const rel = relMap.get(attr(s, "id") ?? "");
    if (!rel || !/worksheet$/.test(rel.type)) continue; // planilha de gráfico ou macro
    const doc = await xml(resolveTarget(rel.target));
    if (!doc) continue;
    const state = attr(s, "state");
    sheets.push(readSheet(doc, attr(s, "name") ?? `Planilha${i + 1}`, i, state === "hidden" || state === "veryHidden", strings, theme, styles));
  }

  // Área de impressão e linhas repetidas (nomes definidos por planilha).
  for (const dn of kids(kid(root, "definedNames"), "definedName")) {
    const local = attr(dn, "localSheetId");
    if (local === null) continue;
    const sheet = sheets.find((s) => s.index === Number(local));
    if (!sheet) continue;
    const name = attr(dn, "name");
    const text = dn.textContent ?? "";
    if (name === "_xlnm.Print_Area") {
      // Várias áreas separadas por vírgula: vale a primeira.
      sheet.printArea = parseRange(text.split(",")[0]);
    } else if (name === "_xlnm.Print_Titles") {
      for (const part of text.split(",")) {
        const m = /\$(\d+):\$(\d+)/.exec(part);
        if (m) sheet.printTitleRows = [Number(m[1]) - 1, Number(m[2]) - 1];
      }
    }
  }
  return { sheets, styles, defaultFont, date1904 };
}
