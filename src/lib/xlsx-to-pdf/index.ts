/**
 * Excel para PDF, como o "Salvar como PDF" do Excel.
 *
 * Cada planilha vira tabelas no mesmo modelo do Word para PDF, e o mesmo motor
 * monta, pagina e grava: texto real, nas fontes de métrica igual às do Office.
 * O que é do Excel e não do Word fica aqui:
 *
 * - sem linhas de grade, a não ser que a planilha peça para imprimi-las;
 * - texto que não cabe invade as células vazias ao lado; número não cabe,
 *   vira "####" (e o formato Geral perde casas decimais antes disso);
 * - escala, "ajustar à página", área de impressão, linhas repetidas,
 *   quebras manuais, centralizar na página, cabeçalho e rodapé (&P, &N, &A…);
 * - planilha mais larga que a página continua nas páginas seguintes, coluna a
 *   coluna (primeiro para baixo, depois para o lado).
 */

import { FontManager, fontKeyFor } from "../docx-to-pdf/fonts";
import { modelToPdf } from "../docx-to-pdf";
import type { Block, Border, Cell, DocModel, Inline, Paragraph, ParaProps, Row, RunProps, Section, SectionProps, Table } from "../docx-to-pdf/model";
import { readWorkbook, type XCell, type XFont, type XRange, type XSheet, type XStyle, type XWorkbook } from "./read";

export interface XlsxToPdfOptions {
  onProgress?: (fraction: number, status: string) => void;
  /** Nome do arquivo, para o código &F do cabeçalho. */
  fileName?: string;
}

type Ssf = { format: (fmt: string, value: number, opts?: { date1904?: boolean }) => string; is_date: (fmt: string) => boolean };

const PAPER: Record<number, [number, number]> = {
  1: [612, 792], 3: [792, 1224], 5: [612, 1008], 7: [522, 756], 8: [841.89, 1190.55], 9: [595.28, 841.89],
  11: [419.53, 595.28], 12: [728.5, 1031.81], 13: [515.91, 728.5],
};

/** Folga do texto até a linha da célula (2 px a 100%). */
const CELL_PAD = 1.5;

const BASE_RUN: RunProps = {
  font: "Calibri", size: 11, bold: false, italic: false, underline: null, strike: false, doubleStrike: false,
  color: null, highlight: null, shading: null, vertAlign: null, caps: false, smallCaps: false, hidden: false,
  spacing: 0, position: 0,
};

const runOf = (f: XFont, scale: number, color?: string | null): RunProps => ({
  ...BASE_RUN,
  font: f.name,
  size: f.size * scale,
  bold: f.bold,
  italic: f.italic,
  underline: f.underline,
  strike: f.strike,
  color: color ?? f.color,
  vertAlign: f.vertAlign,
});

function paragraph(align: ParaProps["align"], inlines: Inline[], mark: RunProps, opts: { noWrap: boolean; indent: number }): Paragraph {
  return {
    kind: "p",
    props: {
      styleId: null, align, indLeft: align === "right" ? 0 : opts.indent, indRight: align === "right" ? opts.indent : 0,
      indFirst: 0, spaceBefore: 0, spaceAfter: 0, line: 1, lineRule: "auto", contextual: false, keepNext: false,
      keepLines: false, pageBreakBefore: false, widowControl: false, noWrap: opts.noWrap, tabs: [], shading: null,
      borders: {}, markProps: mark,
    },
    marker: null,
    inlines,
  };
}

// ------------------------------------------------------------------ medidas

/** Largura de texto, com as mesmas fontes (e sem kerning) da montagem. */
class Meter {
  private readonly ctx = document.createElement("canvas").getContext("2d")!;
  private readonly cache = new Map<string, number>();
  constructor() {
    (this.ctx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = "none";
  }
  width(text: string, f: XFont | RunProps, scale = 1): number {
    const key = fontKeyFor("name" in f ? f.name : f.font);
    const size = ("name" in f ? f.size * scale : f.size);
    const css = `${f.italic ? "italic " : ""}${f.bold ? 700 : 400} ${size}pt "docx-${key}", "docx-symbols"`;
    const id = `${css}|${text}`;
    let w = this.cache.get(id);
    if (w === undefined) {
      this.ctx.font = css;
      w = this.ctx.measureText(text).width * 0.75;
      this.cache.set(id, w);
    }
    return w;
  }
}

// ------------------------------------------------------------------ formatos

interface Locale {
  comma: boolean;
  bool: [string, string];
  errors: Record<string, string>;
}

function localeOf(): Locale {
  const lang = (typeof navigator !== "undefined" && navigator.language) || "pt-BR";
  const decimal = new Intl.NumberFormat(lang).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ",";
  const pt = /^pt/i.test(lang);
  return {
    comma: decimal === ",",
    bool: pt ? ["VERDADEIRO", "FALSO"] : ["TRUE", "FALSE"],
    errors: pt
      ? { "#N/A": "#N/D", "#VALUE!": "#VALOR!", "#NAME?": "#NOME?", "#NUM!": "#NÚM!", "#NULL!": "#NULO!" }
      : {},
  };
}

/** Separadores do idioma: só entre dígitos (não mexe em texto literal do formato). */
const localize = (text: string, loc: Locale) =>
  loc.comma ? text.replace(/(\d)([.,])(?=\d)/g, (_, d: string, sep: string) => d + (sep === "." ? "," : ".")) : text;

/** Seção do formato que vale para o valor (positivo; negativo; zero; texto). */
function sectionOf(fmt: string, value: number): string {
  const parts: string[] = [];
  let cur = "";
  let quote = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') quote = !quote;
    if (ch === "\\" && i + 1 < fmt.length) {
      cur += ch + fmt[++i];
      continue;
    }
    if (ch === ";" && !quote) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  if (value < 0 && parts.length > 1) return parts[1];
  if (value === 0 && parts.length > 2) return parts[2];
  return parts[0];
}

const FORMAT_COLORS: Record<string, string> = {
  black: "#000000", white: "#FFFFFF", red: "#FF0000", green: "#00FF00", blue: "#0000FF",
  yellow: "#FFFF00", magenta: "#FF00FF", cyan: "#00FFFF",
  preto: "#000000", branco: "#FFFFFF", vermelho: "#FF0000", verde: "#00FF00", azul: "#0000FF",
  amarelo: "#FFFF00", magenta2: "#FF00FF", ciano: "#00FFFF",
};

/** Cor pedida pelo formato ("[Red]", "[Vermelho]"), quando há. */
export function formatColor(fmt: string, value: number): string | null {
  const m = /\[([A-Za-z]+)\]/.exec(sectionOf(fmt, value));
  return m ? FORMAT_COLORS[m[1].toLowerCase()] ?? null : null;
}

/**
 * Formatação numérica básica (zeros obrigatórios, milhar, casas, porcentagem,
 * texto literal) para os formatos que o SheetJS recusa.
 */
export function basicNumberFormat(fmt: string, value: number): string {
  const sections = fmt.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let section = sectionOf(fmt, value);
  const explicitNegative = value < 0 && sections.length > 1;
  section = section.replace(/\[(?:[A-Za-z]+|Color\s*\d+)\]/gi, "").replace(/\[\$([^\]-]*)(?:-[^\]]*)?\]/g, "$1");
  // Texto literal ("R$ ", \-) vira marcador, para não confundir com o número.
  const literals: string[] = [];
  section = section.replace(/"([^"]*)"|\\(.)/g, (_m, q: string | undefined, ch: string | undefined) => {
    literals.push(q ?? ch ?? "");
    // Um caractere de uso privado por literal: não tem dígito para confundir.
    return String.fromCharCode(0xe000 + literals.length - 1);
  });
  const m = /[0#?][0#?,]*(?:\.[0#?]*)?|\.[0#?]+/.exec(section);
  if (!m) return String(value);
  const core = m[0];
  const [intPart, decPart = ""] = core.split(".");
  let v = Math.abs(value);
  if (section.includes("%")) v *= 100;
  // Vírgulas no fim da parte inteira dividem por mil.
  const trailing = /,+$/.exec(intPart)?.[0].length ?? 0;
  v /= 1000 ** trailing;
  const decimals = decPart.length;
  const required = decPart.replace(/[#?]+$/, "").length;
  let [whole, frac = ""] = v.toFixed(decimals).split(".");
  frac = frac.replace(/0+$/, "").padEnd(required, "0");
  const minInt = (intPart.replace(/,/g, "").match(/0/g) ?? []).length;
  if (whole === "0" && minInt === 0) whole = "";
  whole = whole.padStart(minInt, "0");
  if (/[0#?],[0#?]/.test(intPart)) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const number = whole + (frac ? `.${frac}` : decPart.length && required ? "." : "");
  const sign = value < 0 && !explicitNegative ? "-" : "";
  const out = section.slice(0, m.index) + sign + number + section.slice(m.index + core.length);
  return out.replace(/[-]/g, (ch) => literals[ch.charCodeAt(0) - 0xe000] ?? "");
}

/** Formatos de data curta que o Excel mostra no padrão do sistema. */
function localFormat(style: XStyle, loc: Locale): string {
  if (!loc.comma) return style.numFmt;
  if (style.numFmtId === 14) return "dd/mm/yyyy";
  if (style.numFmtId === 22) return "dd/mm/yyyy hh:mm";
  return style.numFmt;
}

/**
 * Número no formato Geral numa coluna estreita: o Excel tira casas decimais
 * até caber, passa para notação científica e, só então, mostra "####".
 */
export function fitGeneral(value: number, fits: (text: string) => boolean, loc: Locale): string | null {
  const plain = (t: string) => localize(t, loc);
  const abs = Math.abs(value);
  if (!Number.isInteger(value)) {
    const intDigits = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 1;
    for (let d = Math.max(0, 10 - intDigits); d >= 0; d--) {
      const t = plain(String(Number(value.toFixed(d))));
      if (fits(t)) return t;
    }
  } else if (fits(plain(String(value)))) return plain(String(value));
  for (let d = 5; d >= 0; d--) {
    const [m, e] = value.toExponential(d).split("e");
    const exp = Number(e);
    const t = plain(`${Number(m)}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`);
    if (fits(t)) return t;
  }
  return null;
}

// ------------------------------------------------------------------ células

interface Built {
  /** Texto exibido (já formatado), ou runs quando é texto rico. */
  runs: { text: string; font: XFont; color?: string | null }[];
  numeric: boolean;
  align: "left" | "center" | "right" | "justify" | "fill";
  empty: boolean;
}

function cellContent(cell: XCell | undefined, style: XStyle, ssf: Ssf, wb: XWorkbook, loc: Locale): Built {
  const font = style.font;
  const horiz = style.horizontal;
  const explicit = horiz === "left" || horiz === "center" || horiz === "right" || horiz === "justify" || horiz === "fill"
    ? horiz
    : horiz === "centerContinuous" ? "center" : horiz === "distributed" ? "justify" : null;
  if (!cell || cell.value === null || cell.value === "") {
    return { runs: [], numeric: false, align: explicit ?? "left", empty: true };
  }
  if (cell.type === "s") {
    const runs = cell.runs ?? [{ text: String(cell.value), font }];
    return { runs, numeric: false, align: explicit ?? "left", empty: false };
  }
  if (cell.type === "b") {
    return { runs: [{ text: cell.value ? loc.bool[0] : loc.bool[1], font }], numeric: false, align: explicit ?? "center", empty: false };
  }
  if (cell.type === "e") {
    const text = String(cell.value);
    return { runs: [{ text: loc.errors[text] ?? text, font }], numeric: false, align: explicit ?? "center", empty: false };
  }
  const value = Number(cell.value);
  const fmt = localFormat(style, loc);
  let text: string;
  try {
    text = ssf.format(fmt, value, { date1904: wb.date1904 });
  } catch {
    // Formato que o SheetJS não entende ("#,000", por exemplo): o básico à mão.
    text = basicNumberFormat(fmt, value);
  }
  if (!ssf.is_date(fmt)) text = localize(text, loc);
  else if (text === String(value)) text = localize(text, loc);
  return { runs: [{ text, font, color: formatColor(fmt, value) }], numeric: true, align: explicit ?? "right", empty: false };
}

// ------------------------------------------------------------------ bordas

function border(side: { style: string; color: string | null } | undefined, scale: number): Border | undefined {
  if (!side) return undefined;
  const s = side.style;
  const width = s === "hair" ? 0.35 : s.startsWith("medium") ? 1.5 : s === "thick" ? 2.25 : s === "double" ? 2.25 : 0.75;
  const style: Border["style"] = s === "double" ? "double" : s === "dotted" || s === "hair" ? "dotted" : /dash/i.test(s) ? "dashed" : "solid";
  return { width: Math.max(0.25, width * Math.min(1, scale)), color: side.color ?? "#000000", style, space: 0 };
}

// ------------------------------------------------------------------ planilha

/**
 * Largura de um dígito, em em, das fontes do Office que não têm equivalente
 * de mesma métrica no pacote (medida no PDF do Excel). As outras são medidas.
 */
const DIGIT_EM: Record<string, number> = { "aptos narrow": 0.5128 };

interface SheetGeometry {
  colWidth: (c: number) => number;
  rowHeight: (r: number) => number;
  colHidden: (c: number) => boolean;
  rowHidden: (r: number) => boolean;
}

/**
 * Medidas como o Excel imprime (conferidas no PDF dele): a largura da coluna é
 * a largura gravada vezes a largura real de um dígito da fonte padrão, sem o
 * arredondamento para pixel da tela; a altura da linha ganha o `dyDescent`.
 */
function geometry(sheet: XSheet, digitPt: number, mdwPx: number, defaultHeight: number): SheetGeometry {
  // Largura padrão em caracteres -> largura gravada (com a folga de 5 px).
  const stored = (chars: number) => Math.trunc(((chars * mdwPx + 5) / mdwPx) * 256) / 256;
  const defaultWidth = stored(sheet.defaultColWidth ?? sheet.baseColWidth);
  const colInfo = (c: number) => sheet.cols.find((x) => c >= x.min && c <= x.max);
  return {
    colWidth: (c) => {
      const info = colInfo(c);
      return (info?.width !== null && info?.width !== undefined ? info.width : defaultWidth) * digitPt;
    },
    rowHeight: (r) => {
      const info = sheet.rows.get(r);
      return (info?.height ?? defaultHeight) + (info?.descent ?? sheet.descent);
    },
    colHidden: (c) => colInfo(c)?.hidden === true,
    rowHidden: (r) => sheet.rows.get(r)?.hidden === true,
  };
}

/** Faixa que o Excel imprime: a área de impressão, ou o intervalo usado. */
function usedRange(sheet: XSheet, wb: XWorkbook): XRange | null {
  if (sheet.printArea) return sheet.printArea;
  let r1 = Infinity;
  let c1 = Infinity;
  let r2 = -1;
  let c2 = -1;
  const visible = (s: XStyle | undefined) => Boolean(s && (s.fill || s.border.left || s.border.right || s.border.top || s.border.bottom));
  for (const [r, line] of sheet.cells) {
    for (const [c, cell] of line) {
      const hasValue = cell.value !== null && cell.value !== "";
      if (!hasValue && !visible(wb.styles[cell.style])) continue;
      r1 = Math.min(r1, r);
      r2 = Math.max(r2, r);
      c1 = Math.min(c1, c);
      c2 = Math.max(c2, c);
    }
  }
  for (const m of sheet.merges) {
    if (r2 < 0) break;
    r1 = Math.min(r1, m.r1);
    r2 = Math.max(r2, m.r2);
    c1 = Math.min(c1, m.c1);
    c2 = Math.max(c2, m.c2);
  }
  return r2 < 0 ? null : { r1, c1, r2, c2 };
}

/** Códigos de cabeçalho e rodapé do Excel em parágrafo (esquerda, centro, direita). */
function headerFooter(code: string | null, font: XFont, width: number, sheetName: string, fileName: string, scale: number): Block[] | undefined {
  if (!code) return undefined;
  const sections: Record<"L" | "C" | "R", Inline[]> = { L: [], C: [], R: [] };
  let where: "L" | "C" | "R" = "C";
  let f: XFont = { ...font };
  let buf = "";
  const flush = () => {
    if (buf) sections[where].push({ kind: "text", text: buf, props: runOf(f, scale) });
    buf = "";
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch !== "&") {
      buf += ch;
      continue;
    }
    const next = code[i + 1] ?? "";
    i++;
    if (next === "&") buf += "&";
    else if (next === "L" || next === "C" || next === "R") {
      flush();
      where = next;
    } else if (next === "P" || next === "N") {
      flush();
      // &N, na pasta inteira, é o total de páginas do PDF (conferido no Excel).
      sections[where].push({ kind: "field", field: next === "P" ? "PAGE" : "NUMPAGES", props: runOf(f, scale), fallback: "1" });
    } else if (next === "A") buf += sheetName;
    else if (next === "F") buf += fileName;
    else if (next === "Z") buf += "";
    else if (next === "D") buf += new Date().toLocaleDateString();
    else if (next === "T") buf += new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    else if (next === "B" || next === "I" || next === "S" || next === "U" || next === "E") {
      flush();
      if (next === "B") f = { ...f, bold: !f.bold };
      else if (next === "I") f = { ...f, italic: !f.italic };
      else if (next === "S") f = { ...f, strike: !f.strike };
      else f = { ...f, underline: f.underline ? null : "single" };
    } else if (next === '"') {
      flush();
      const end = code.indexOf('"', i + 1);
      const spec = code.slice(i + 1, end < 0 ? code.length : end);
      i = end < 0 ? code.length : end;
      const [name, style = ""] = spec.split(",");
      if (name && name !== "-") f = { ...f, name };
      f = { ...f, bold: /bold|negrito/i.test(style), italic: /italic|itálico/i.test(style) };
    } else if (/\d/.test(next)) {
      flush();
      let digits = next;
      while (/\d/.test(code[i + 1] ?? "")) digits += code[++i];
      f = { ...f, size: Number(digits) };
    } else if (next === "K") i += 6; // cor: ignorada
    else if (next === "G") { /* imagem: não suportada */ }
  }
  flush();
  const mark = runOf(font, scale);
  const parts = (["L", "C", "R"] as const).filter((k) => sections[k].length);
  if (!parts.length) return undefined;
  if (parts.length === 1) {
    const k = parts[0];
    return [paragraph(k === "L" ? "left" : k === "C" ? "center" : "right", sections[k], mark, { noWrap: false, indent: 0 })];
  }
  // Mais de uma seção: tabulações central e à direita na mesma linha.
  const inlines: Inline[] = [...sections.L, { kind: "tab", props: mark }, ...sections.C, { kind: "tab", props: mark }, ...sections.R];
  const p = paragraph("left", inlines, mark, { noWrap: false, indent: 0 });
  p.props.tabs = [
    { pos: width / 2, align: "center", leader: "none" },
    { pos: width, align: "right", leader: "none" },
  ];
  return [p];
}

/** Subida e descida da fonte, em pontos, como o motor as usa. */
type VerticalMetrics = { ascent: (f: XFont) => number; descent: (f: XFont) => number };

function sheetSections(sheet: XSheet, wb: XWorkbook, ssf: Ssf, meter: Meter, loc: Locale, fileName: string, vm: VerticalMetrics): Section[] {
  const range = usedRange(sheet, wb);
  if (!range) return [];
  const defFont = wb.defaultFont;
  // Largura de um dígito da fonte padrão: a régua das colunas.
  const known = DIGIT_EM[defFont.name.trim().toLowerCase()];
  const digitPt = known ? known * defFont.size : Math.max(...[..."0123456789"].map((d) => meter.width(d, defFont))) || 5.5;
  const mdwPx = Math.round(digitPt / 0.75) || 7;
  const naturalPx = defFont.size * (96 / 72) * 1.2207;
  const defaultHeight = sheet.defaultRowHeight ?? (Math.round(naturalPx) + 2) * 0.75;
  const geo = geometry(sheet, digitPt, mdwPx, defaultHeight);

  const cols: number[] = [];
  for (let c = range.c1; c <= range.c2; c++) if (!geo.colHidden(c)) cols.push(c);
  const titleRows: number[] = [];
  if (sheet.printTitleRows) {
    for (let r = sheet.printTitleRows[0]; r <= sheet.printTitleRows[1]; r++) if (!geo.rowHidden(r) && r < range.r1) titleRows.push(r);
  }
  const bodyRows: number[] = [];
  for (let r = range.r1; r <= range.r2; r++) if (!geo.rowHidden(r)) bodyRows.push(r);
  if (!cols.length || !bodyRows.length) return [];
  const isTitle = (r: number) => sheet.printTitleRows !== null && r >= sheet.printTitleRows[0] && r <= sheet.printTitleRows[1];

  // Página.
  const [pw, ph] = PAPER[sheet.page.paperSize ?? 9] ?? PAPER[9];
  const [pageW, pageH] = sheet.page.orientation === "landscape" ? [Math.max(pw, ph), Math.min(pw, ph)] : [Math.min(pw, ph), Math.max(pw, ph)];
  const m = sheet.margins;
  // Cabeçalho e rodapé: o Excel põe a linha de base 1,091 corpo abaixo da
  // margem do cabeçalho e 1,655 corpo acima da do rodapé (medido no PDF dele,
  // com a Aptos Narrow 11). O motor mede como o Word; a diferença vai na margem.
  const margins = {
    top: m.top * 72, bottom: m.bottom * 72, left: m.left * 72, right: m.right * 72,
    header: m.header * 72 + Math.max(0, 1.091 * defFont.size - vm.ascent(defFont)),
    footer: m.footer * 72 + Math.max(0, 1.655 * defFont.size - vm.descent(defFont)),
    gutter: 0,
  };
  const printW = pageW - margins.left - margins.right;
  const printH = pageH - margins.top - margins.bottom;

  // Escala: a pedida, ou a que faz caber em N páginas.
  const totalW = cols.reduce((s, c) => s + geo.colWidth(c), 0);
  const totalH = [...titleRows, ...bodyRows].reduce((s, r) => s + geo.rowHeight(r), 0);
  let scale = Math.min(4, Math.max(0.1, sheet.page.scale / 100));
  if (sheet.page.fitToPage) {
    const sw = sheet.page.fitToWidth > 0 ? (sheet.page.fitToWidth * printW) / totalW : Infinity;
    const sh = sheet.page.fitToHeight > 0 ? (sheet.page.fitToHeight * printH) / totalH : Infinity;
    scale = Math.max(0.1, Math.min(1, sw, sh));
  }

  // Colunas por página (da esquerda para a direita), com as quebras manuais.
  const groups: number[][] = [];
  let group: number[] = [];
  let used = 0;
  for (const c of cols) {
    const w = geo.colWidth(c) * scale;
    const manual = sheet.colBreaks.includes(c) && group.length > 0;
    if (group.length && (manual || used + w > printW + 0.5)) {
      groups.push(group);
      group = [];
      used = 0;
    }
    group.push(c);
    used += w;
  }
  if (group.length) groups.push(group);

  // Mesclagens: a célula de cima à esquerda manda; as outras somem.
  const mergeAt = new Map<string, XRange>();
  const covered = new Set<string>();
  for (const mg of sheet.merges) {
    mergeAt.set(`${mg.r1},${mg.c1}`, mg);
    for (let r = mg.r1; r <= mg.r2; r++) for (let c = mg.c1; c <= mg.c2; c++) if (r !== mg.r1 || c !== mg.c1) covered.add(`${r},${c}`);
  }
  const mergeOf = (r: number, c: number) => {
    for (const mg of sheet.merges) if (r >= mg.r1 && r <= mg.r2 && c >= mg.c1 && c <= mg.c2) return mg;
    return null;
  };

  const cellAt = (r: number, c: number) => sheet.cells.get(r)?.get(c);
  const styleAt = (r: number, c: number): XStyle => {
    const cell = cellAt(r, c);
    if (cell) return wb.styles[cell.style] ?? wb.styles[0];
    const rowStyle = sheet.rows.get(r)?.style;
    if (rowStyle !== null && rowStyle !== undefined) return wb.styles[rowStyle] ?? wb.styles[0];
    const colStyle = sheet.cols.find((x) => c >= x.min && c <= x.max)?.style;
    return colStyle !== null && colStyle !== undefined ? wb.styles[colStyle] ?? wb.styles[0] : wb.styles[0];
  };
  const isEmpty = (r: number, c: number) => {
    const cell = cellAt(r, c);
    return (!cell || cell.value === null || cell.value === "") && !covered.has(`${r},${c}`) && !mergeAt.has(`${r},${c}`);
  };

  const sheetName = sheet.name;
  const sections: Section[] = [];
  groups.forEach((gcols, gi) => {
    const grid = gcols.map((c) => geo.colWidth(c) * scale);
    const indexOf = new Map(gcols.map((c, i) => [c, i]));
    const buildRow = (r: number, header: boolean): Row => {
      const height = geo.rowHeight(r) * scale;
      const info = sheet.rows.get(r);
      const row: Row = {
        height,
        // Altura gravada sem "personalizada" é a que o Excel calculou: o
        // conteúdo pode pedir mais, nunca menos.
        heightRule: info?.custom ? "exact" : "atLeast",
        header,
        cantSplit: true,
        cells: [],
        gridBefore: 0,
        breakBefore: !header && sheet.rowBreaks.includes(r) && r !== bodyRows[0],
      };
      for (let i = 0; i < gcols.length; i++) {
        const c = gcols[i];
        const key = `${r},${c}`;
        const merge = mergeAt.get(key) ?? null;
        const inMerge = covered.has(key) ? mergeOf(r, c) : null;
        let span = 1;
        let vMerge: Cell["vMerge"] = null;
        let anchorR = r;
        let anchorC = c;
        if (inMerge) {
          // Coberta por mesclagem: na mesma linha da âncora, a âncora já cobre;
          // nas de baixo, continua a mesclagem vertical (na primeira coluna dela
          // que está nesta página).
          const firstVisible = gcols.find((cc) => cc >= inMerge.c1 && cc <= inMerge.c2);
          if (r === inMerge.r1 && !(c === firstVisible && !indexOf.has(inMerge.c1))) continue;
          if (c !== firstVisible) continue;
          anchorR = inMerge.r1;
          anchorC = inMerge.c1;
          span = gcols.filter((cc) => cc >= inMerge.c1 && cc <= inMerge.c2).length;
          vMerge = r > inMerge.r1 ? "continue" : inMerge.r2 > inMerge.r1 ? "restart" : null;
        } else if (merge) {
          span = gcols.filter((cc) => cc >= merge.c1 && cc <= merge.c2).length;
          vMerge = merge.r2 > merge.r1 ? "restart" : null;
        }
        const style = styleAt(anchorR, anchorC);
        // Borda da direita e de baixo de uma mesclagem vêm das células da borda.
        const region = merge ?? inMerge;
        const rightStyle = region ? styleAt(r, Math.min(region.c2, gcols[Math.min(gcols.length - 1, i + span - 1)])) : style;
        const bottomStyle = region ? styleAt(region.r2, anchorC) : style;
        const sideStyle = region ? styleAt(r, anchorC) : style;
        const borders: Cell["borders"] = {
          top: border(sideStyle.border.top, scale),
          bottom: border((region ? bottomStyle : sideStyle).border.bottom, scale),
          left: border(sideStyle.border.left, scale),
          right: border(rightStyle.border.right, scale),
        };
        if (sheet.gridLines) {
          const grid: Border = { width: 0.5, color: "#000000", style: "solid", space: 0 };
          for (const k of ["top", "bottom", "left", "right"] as const) borders[k] ??= grid;
        }
        for (const k of ["top", "bottom", "left", "right"] as const) if (!borders[k]) delete borders[k];

        const width = grid.slice(i, i + span).reduce((a, b) => a + b, 0);
        const inner = Math.max(1, width - 2 * CELL_PAD * scale);
        const content = vMerge === "continue" ? null : cellContent(cellAt(anchorR, anchorC), style, ssf, wb, loc);
        let overflow: Cell["overflow"];
        // Mesclagem partida entre páginas: o texto se alinha na mesclagem
        // inteira e cada página mostra só a sua parte, como no Excel.
        if (region) {
          let hiddenLeft = 0;
          let hiddenRight = 0;
          for (let cc = region.c1; cc <= region.c2; cc++) {
            if (indexOf.has(cc) || geo.colHidden(cc)) continue;
            if (cc < gcols[0]) hiddenLeft += geo.colWidth(cc) * scale;
            else hiddenRight += geo.colWidth(cc) * scale;
          }
          if (hiddenLeft || hiddenRight) overflow = { left: hiddenLeft, right: hiddenRight, clipToCell: true };
        }
        const blocks: Block[] = [];
        const markFont = runOf(style.font, scale);
        if (content && !content.empty) {
          const wrap = style.wrap || content.align === "justify";
          const indentPt = style.indent * 9 * 0.75 * scale;
          let runs = content.runs;
          const textOf = () => runs.map((x) => x.text).join("");
          const widthOf = () => runs.reduce((s, x) => s + meter.width(x.text, x.font, scale), 0);
          const avail = inner - indentPt;
          let fontScale = 1;
          if (!wrap && content.numeric && widthOf() > avail) {
            const cell = cellAt(anchorR, anchorC)!;
            const fitted = style.numFmt === "General" && !style.shrink
              ? fitGeneral(Number(cell.value), (t) => meter.width(t, style.font, scale) <= avail, loc)
              : null;
            if (style.shrink) fontScale = Math.max(0.3, avail / widthOf());
            else if (fitted) runs = [{ ...runs[0], text: fitted }];
            else {
              // Não cabe: o Excel preenche com "#".
              const hash = meter.width("#", style.font, scale) || 5;
              runs = [{ ...runs[0], text: "#".repeat(Math.max(1, Math.floor(avail / hash))) }];
            }
          } else if (!wrap && !content.numeric && style.shrink && widthOf() > avail) {
            fontScale = Math.max(0.3, avail / widthOf());
          } else if (overflow?.clipToCell) {
            // Mesclagem partida: já tem a caixa dela.
          } else if (!wrap && !content.numeric && content.align !== "fill" && widthOf() > avail && !region) {
            // Texto que não cabe invade as vizinhas vazias (e é cortado na primeira cheia).
            const need = widthOf() - avail;
            let left = 0;
            let right = 0;
            if (content.align === "left") {
              for (let k = i + 1; k < gcols.length && right < need && isEmpty(r, gcols[k]); k++) right += grid[k];
            } else if (content.align === "right") {
              for (let k = i - 1; k >= 0 && left < need && isEmpty(r, gcols[k]); k--) left += grid[k];
            } else {
              for (let k = 1; i - k >= 0 && i + k < gcols.length && left + right < need && isEmpty(r, gcols[i - k]) && isEmpty(r, gcols[i + k]); k++) {
                left += grid[i - k];
                right += grid[i + k];
              }
            }
            overflow = { left, right };
          } else if (!wrap && !region) {
            overflow = { left: 0, right: 0 };
          }
          if (content.align === "fill") {
            const unit = widthOf();
            if (unit > 0) {
              const times = Math.max(1, Math.floor(avail / unit));
              runs = runs.map((x) => ({ ...x, text: x.text.repeat(times) }));
            }
          }
          void textOf;
          const inlines: Inline[] = runs.map((x) => ({
            kind: "text",
            text: x.text,
            props: runOf({ ...x.font, size: x.font.size * fontScale }, scale, x.color ?? x.font.color),
          }));
          const align: ParaProps["align"] = content.align === "fill" ? "left" : content.align;
          blocks.push(paragraph(align, inlines, markFont, { noWrap: !wrap, indent: indentPt }));
        } else {
          blocks.push(paragraph("left", [], markFont, { noWrap: true, indent: 0 }));
        }
        row.cells.push({
          span,
          vMerge,
          width: null,
          shading: style.fill,
          borders,
          vAlign: style.vertical === "top" ? "top" : style.vertical === "center" || style.vertical === "distributed" || style.vertical === "justify" ? "center" : "bottom",
          margins: { top: 0, bottom: 0, left: CELL_PAD * scale, right: CELL_PAD * scale },
          blocks,
          overflow,
        });
      }
      return row;
    };
    const rows = [...titleRows.map((r) => buildRow(r, true)), ...bodyRows.map((r) => buildRow(r, isTitle(r)))];
    // Linhas repetidas que não estão no começo (título acima delas): a parte
    // de cima vira uma tabela à parte, para que elas abram a tabela de baixo e
    // se repitam nas páginas seguintes, como no Excel.
    const firstTitle = rows.findIndex((r) => r.header);
    const parts = firstTitle > 0 ? [rows.slice(0, firstTitle), rows.slice(firstTitle)] : [rows];
    for (const part of parts) {
      let leading = true;
      for (const row of part) {
        if (!row.header) leading = false;
        else if (!leading) row.header = false;
      }
    }
    const tables: Table[] = parts.map((part) => ({
      kind: "table", grid, width: null, fixed: true, align: sheet.centerH ? "center" : "left", indent: 0, rows: part,
      gridBorders: true,
    }));
    const footerText = sheet.differentFirst ? sheet.firstFooter : null;
    const headerText = sheet.differentFirst ? sheet.firstHeader : null;
    const textW = pageW - margins.left - margins.right;
    const props: SectionProps = {
      pageWidth: pageW,
      pageHeight: pageH,
      margins,
      columns: { count: 1, space: 0, separator: false, widths: null },
      type: "nextPage",
      titlePage: sheet.differentFirst && gi === 0,
      headers: {
        default: headerFooter(sheet.header, defFont, textW, sheetName, fileName, 1),
        first: headerFooter(headerText, defFont, textW, sheetName, fileName, 1),
      },
      footers: {
        default: headerFooter(sheet.footer, defFont, textW, sheetName, fileName, 1),
        first: headerFooter(footerText, defFont, textW, sheetName, fileName, 1),
      },
      pageNumberStart: gi === 0 ? sheet.page.firstPageNumber ?? 1 : null,
    };
    sections.push({ props, blocks: tables });
  });
  return sections;
}

/** Arquivo .xls (formato binário antigo): convertido para .xlsx pelo SheetJS. */
async function toXlsx(data: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return data;
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellStyles: true, cellNF: true });
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  return out as ArrayBuffer;
}

export async function xlsxToPdf(data: ArrayBuffer, options: XlsxToPdfOptions = {}) {
  const progress = options.onProgress ?? (() => {});
  progress(0.05, "Lendo a planilha...");
  const JSZip = (await import("jszip")).default;
  let zip: import("jszip");
  try {
    zip = await JSZip.loadAsync(await toXlsx(data));
  } catch {
    throw new Error("Este arquivo não é uma planilha Excel válida.");
  }
  const wb = await readWorkbook(zip);
  const XLSX = await import("xlsx");
  const ssf = XLSX.SSF as Ssf;
  const loc = localeOf();

  // Fontes de todas as células, para medir antes de montar.
  progress(0.1, "Carregando as fontes...");
  const fonts = new FontManager();
  const needed = new Map<string, { key: ReturnType<typeof fontKeyFor>; bold: boolean; italic: boolean }>();
  const want = (f: XFont) => {
    const key = fontKeyFor(f.name);
    needed.set(`${key}|${f.bold}|${f.italic}`, { key, bold: f.bold, italic: f.italic });
    needed.set(`${key}|false|false`, { key, bold: false, italic: false });
  };
  want(wb.defaultFont);
  for (const s of wb.styles) want(s.font);
  for (const sheet of wb.sheets) for (const line of sheet.cells.values()) for (const c of line.values()) c.runs?.forEach((r) => want(r.font));
  await Promise.all([fonts.load("symbols", false, false), ...[...needed.values()].map((f) => fonts.load(f.key, f.bold, f.italic))]);
  await document.fonts.ready;
  const meter = new Meter();
  const vm: VerticalMetrics = {
    ascent: (f) => fonts.ascent(fontKeyFor(f.name), f.size, f.bold, f.italic),
    descent: (f) => fonts.lineHeight(fontKeyFor(f.name), f.size, f.bold, f.italic) - fonts.ascent(fontKeyFor(f.name), f.size, f.bold, f.italic),
  };

  progress(0.2, "Montando as páginas...");
  const sections: Section[] = [];
  for (const sheet of wb.sheets) {
    if (sheet.hidden) continue;
    sections.push(...sheetSections(sheet, wb, ssf, meter, loc, options.fileName ?? "", vm));
  }
  if (!sections.length) throw new Error("A planilha está vazia: não há nada para imprimir.");

  const model: DocModel = {
    sections,
    footnotes: new Map(),
    endnotes: new Map(),
    evenAndOddHeaders: false,
    defaultTab: 36,
    compatMode: 15,
    normalRun: runOf(wb.defaultFont, 1),
  };
  return modelToPdf(model, {
    fonts,
    title: options.fileName?.replace(/\.[^.]+$/, ""),
    onProgress: (f, status) => progress(0.2 + f * 0.8, status),
  });
}
