/**
 * PDF para Excel: tabelas em células, números como números.
 *
 * Usa a mesma leitura do PDF para Word (texto com posição, traços e fundos).
 * Tabela com linhas desenhadas vira a grade exata dela, com mesclagens, fundo e
 * bordas. O resto da página vira linhas da planilha, com as colunas achadas
 * pelos vãos em branco que atravessam as linhas — é assim que um extrato ou um
 * relatório sem linhas continua em colunas no Excel.
 *
 * Valor que é número (1.234,56; R$ 10,00; 12,5%; 31/12/2026) entra como
 * número, com o formato equivalente; código com zero à esquerda, CPF, CEP e
 * telefone continuam texto, como devem.
 */

import { openPdfjs } from "@/lib/pdf-unlock";
import { extractPage } from "@/lib/pdf-to-docx/extract";
import { groupIntoLines, type TextLine } from "@/lib/pdf-to-docx/lines";
import { buildRuledTable, detectRuledGrids } from "@/lib/pdf-to-docx/tables";
import type { Rgb } from "@/lib/pdf-to-docx/types";
import { writeXlsx, type WCell, type WSheet, type WStyle } from "@/lib/xlsx-writer";

export interface PdfToXlsxOptions {
  password?: string;
  /** Todas as páginas numa planilha só (padrão: uma planilha por página). */
  singleSheet?: boolean;
  onProgress?: (percent: number, status: string) => void;
}

export interface PdfToXlsxResult {
  bytes: Uint8Array;
  pages: number;
  pagesWithoutText: number;
}

// ------------------------------------------------------------------ valores

export interface ParsedValue {
  value: number;
  format: string;
}

/**
 * O documento escreve números com vírgula decimal (1.234,56) ou com ponto
 * (1,234.56)? Decide pela maioria dos números que só um dos jeitos explica.
 */
export function detectDecimalComma(texts: string[]): boolean {
  let comma = 0;
  let dot = 0;
  for (const t of texts) {
    if (/\d\.\d{3},\d+\b|^\D*\d+,\d{1,2}\D*$/.test(t)) comma++;
    if (/\d,\d{3}\.\d+\b|^\D*\d+\.\d{1,2}\D*$/.test(t)) dot++;
  }
  return comma >= dot;
}

const CURRENCY = /^(R\$|US\$|U\$|\$|€|£)\s?/;

/** Texto da célula como número (com formato), ou `null` se deve ficar texto. */
export function parseValue(raw: string, decimalComma: boolean): ParsedValue | null {
  let t = raw.trim().replace(/\u00a0/g, " ");
  if (!t || t.length > 30) return null;

  // Data dd/mm/aaaa (ou mm/dd/aaaa, no documento com ponto decimal).
  const date = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
  if (date) {
    let [d, m] = [Number(date[1]), Number(date[2])];
    if (!decimalComma) [d, m] = [m, d];
    let y = Number(date[3]);
    if (date[3].length === 2) y += y < 50 ? 2000 : 1900;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const ms = Date.UTC(y, m - 1, d);
    if (new Date(ms).getUTCDate() !== d) return null;
    return { value: ms / 86400000 + 25569, format: decimalComma ? (date[3].length === 2 ? "dd/mm/yy" : "dd/mm/yyyy") : date[3].length === 2 ? "mm/dd/yy" : "mm/dd/yyyy" };
  }

  let negative = false;
  let parens = false;
  let plus = false;
  if (t.startsWith("+")) {
    plus = true;
    t = t.slice(1).trim();
  }
  if (/^\(.*\)$/.test(t)) {
    negative = parens = true;
    t = t.slice(1, -1).trim();
  }
  if (t.startsWith("-") || t.startsWith("−")) {
    negative = true;
    t = t.slice(1).trim();
  }
  const currency = CURRENCY.exec(t)?.[1] ?? null;
  if (currency) t = t.slice(currency.length).trim();
  if (t.startsWith("-") || t.startsWith("−")) {
    negative = true;
    t = t.slice(1).trim();
  }
  if (t.endsWith("-")) {
    negative = true;
    t = t.slice(0, -1).trim();
  }
  const percent = t.endsWith("%");
  if (percent) t = t.slice(0, -1).trim();

  const thousands = decimalComma ? "." : ",";
  const decimal = decimalComma ? "," : ".";
  const th = thousands === "." ? "\\." : ",";
  const de = decimal === "." ? "\\." : ",";
  const re = new RegExp(`^(\\d{1,3}(?:${th}\\d{3})+|\\d+)(?:${de}(\\d+))?$`);
  const m = re.exec(t);
  if (!m) return null;
  const intPart = m[1];
  const frac = m[2] ?? "";
  const digits = intPart.replace(/\D/g, "");
  // Zero à esquerda (código, CEP sem traço) e números longos (cartão, conta)
  // são identificadores: o Excel os estragaria.
  if (digits.length > 1 && digits.startsWith("0") && !frac) return null;
  if (digits.length + frac.length > 15) return null;
  const grouped = intPart.includes(thousands);
  let value = Number(`${digits}.${frac || "0"}`);
  if (percent) value /= 100;
  if (negative) value = -value;

  const dec = frac ? `.${"0".repeat(frac.length)}` : "";
  let core = `${grouped || currency ? "#,##0" : "0"}${dec}`;
  if (percent) core = `0${dec}%`;
  const prefix = currency ? `"${currency} "` : "";
  const positive = `${prefix}${core}`;
  // Sinal de mais explícito ("+2,3%") continua aparecendo.
  const format = parens
    ? `${positive};(${positive})`
    : plus
      ? `+${positive};-${positive}`
      : positive === "0" ? "General" : positive;
  return { value, format };
}

// ------------------------------------------------------------------ colunas

interface Segment {
  text: string;
  left: number;
  right: number;
  bold: boolean;
  size: number;
  color: Rgb;
}

const isBlack = (c: Rgb) => c.r < 40 && c.g < 40 && c.b < 40;
const hex = (c: Rgb) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * Pedaços de uma linha separados por vãos largos (mais de ~um corpo): cada um
 * é o conteúdo de uma célula. Dentro de um mesmo trecho do PDF, dois ou mais
 * espaços seguidos também separam (relatório alinhado com espaços).
 */
export function segmentsOf(line: TextLine): Segment[] {
  const parts: Segment[] = [];
  const gap = Math.max(4, line.fontSize * 0.9);
  for (const run of [...line.runs].sort((a, b) => a.x - b.x)) {
    const pieces = run.text.split(/(\s{2,})/);
    const perChar = run.text.length ? run.width / run.text.length : 0;
    let offset = 0;
    for (const piece of pieces) {
      const left = run.x + offset * perChar;
      offset += piece.length;
      if (!piece.trim()) continue;
      const right = run.x + offset * perChar;
      const prev = parts[parts.length - 1];
      if (prev && left - prev.right <= gap && !/^\s{2,}/.test(run.text.slice(offset - piece.length - 2, offset - piece.length))) {
        prev.text += (left - prev.right > line.fontSize * 0.15 && !prev.text.endsWith(" ") ? " " : "") + piece;
        prev.right = right;
        prev.bold &&= run.style.bold;
      } else {
        parts.push({ text: piece, left, right, bold: run.style.bold, size: run.style.size, color: run.style.color });
      }
    }
  }
  const out = parts.map((p) => ({ ...p, text: p.text.replace(/\s+/g, " ").trim() })).filter((p) => p.text);
  // Marcador de lista ("•", "o", "1.", "a)") fica junto do texto do item.
  if (out.length > 1 && /^([•◦▪▫●○■□\-–*o]|\d{1,2}[.)]|[a-z][.)])$/.test(out[0].text)) {
    const [marker, item] = out.splice(0, 2);
    out.unshift({ ...item, text: `${marker.text} ${item.text}`, left: marker.left });
  }
  return out;
}

/**
 * Colunas da página: faixas horizontais cobertas pelos pedaços das linhas que
 * têm mais de um pedaço. Uma faixa que junta dois pedaços da mesma linha (um
 * título largo sobre duas colunas) é partida entre eles.
 */
export function columnBands(lines: Segment[][]): { left: number; right: number }[] {
  const multi = lines.filter((l) => l.length > 1);
  if (!multi.length) return [];
  const spans = multi.flat().map((s) => ({ left: s.left, right: s.right })).sort((a, b) => a.left - b.left);
  const bands: { left: number; right: number }[] = [];
  for (const s of spans) {
    const last = bands[bands.length - 1];
    if (last && s.left <= last.right + 1) last.right = Math.max(last.right, s.right);
    else bands.push({ ...s });
  }
  // Partir as faixas que contêm dois pedaços de uma mesma linha.
  const cuts: number[] = [];
  for (const line of multi) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i];
      const b = line[i + 1];
      const band = bands.find((x) => a.left >= x.left - 1 && b.right <= x.right + 1);
      if (band) cuts.push((a.right + b.left) / 2);
    }
  }
  cuts.sort((a, b) => a - b);
  const out: { left: number; right: number }[] = [];
  for (const band of bands) {
    let start = band.left;
    for (const c of cuts) {
      if (c <= start + 1 || c >= band.right - 1) continue;
      out.push({ left: start, right: c });
      start = c;
    }
    out.push({ left: start, right: band.right });
  }
  return out;
}

/**
 * Coluna de um pedaço: pelo centro, quando a linha tem várias colunas; pela
 * borda esquerda, quando é texto corrido (um parágrafo começa na coluna em que
 * a margem dele está, e não no meio da página).
 */
const bandOf = (bands: { left: number; right: number }[], s: Segment, byLeft = false) => {
  const center = byLeft ? s.left + 0.5 : (s.left + s.right) / 2;
  let best = 0;
  let dist = Infinity;
  bands.forEach((b, i) => {
    const d = center < b.left ? b.left - center : center > b.right ? center - b.right : 0;
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
};

// ------------------------------------------------------------------ conversão

function cellFor(text: string, style: Partial<Segment> & { fill?: string | null; border?: boolean; wrap?: boolean }, decimalComma: boolean): WCell {
  const parsed = style.wrap ? null : parseValue(text, decimalComma);
  const s: WStyle = {};
  if (style.bold) s.bold = true;
  if (style.size && style.size >= 13) s.size = Math.round(style.size);
  if (style.color && !isBlack(style.color)) s.color = hex(style.color);
  if (style.fill) s.fill = style.fill;
  if (style.border) s.border = true;
  if (style.wrap) {
    s.wrap = true;
    s.vertical = "top";
  }
  if (parsed && parsed.format !== "General") s.numFmt = parsed.format;
  return { value: parsed ? parsed.value : text, style: Object.keys(s).length ? s : undefined };
}

/** Largura (em caracteres do Excel) para caber o texto mais longo da coluna. */
const charsFor = (text: string) => Math.min(80, Math.max(...text.split("\n").map((l) => l.length)) * 1.1 + 2);

export async function pdfToXlsx(data: ArrayBuffer, options: PdfToXlsxOptions = {}): Promise<PdfToXlsxResult> {
  const report = (p: number, s: string) => options.onProgress?.(Math.max(0, Math.min(100, p)), s);
  report(4, "Abrindo o PDF...");
  const { pdfjsLib } = await import("@/lib/pdfjs-setup");
  const pdf = await openPdfjs(data, options.password);
  const pageCount = pdf.numPages;

  type Item = { top: number; rows: WCell[][]; merges: { r1: number; c1: number; r2: number; c2: number }[]; widths: number[] };
  const pages: Item[][] = [];
  const allTexts: string[] = [];
  const pageLines: { lines: TextLine[]; grids: ReturnType<typeof detectRuledGrids>; content: Awaited<ReturnType<typeof extractPage>> }[] = [];
  let pagesWithoutText = 0;

  for (let i = 1; i <= pageCount; i++) {
    report(4 + (i / pageCount) * 60, `Lendo a página ${i} de ${pageCount}...`);
    const page = await pdf.getPage(i);
    const content = await extractPage(
      pdfjsLib as unknown as Parameters<typeof extractPage>[0],
      page as unknown as Parameters<typeof extractPage>[1],
      i - 1,
    );
    const lines = groupIntoLines(content.runs, {
      barriers: content.rules.filter((r) => r.axis === "v" && r.to - r.from > 4).map((r) => ({ x: r.position, top: r.from, bottom: r.to })),
    }).filter((l) => l.text.trim());
    if (!lines.length) pagesWithoutText++;
    const grids = detectRuledGrids(content.rules);
    pageLines.push({ lines, grids, content });
    for (const l of lines) allTexts.push(...l.text.split(/\s{2,}/));
  }
  if (pagesWithoutText === pageCount) {
    throw new Error("Este PDF não tem texto (é digitalizado): não há tabelas para levar ao Excel.");
  }
  const decimalComma = detectDecimalComma(allTexts);

  report(70, "Montando as planilhas...");
  for (const { lines, grids, content } of pageLines) {
    const items: Item[] = [];
    const inTable = new Set<TextLine>();
    // Tabelas com linhas desenhadas: a grade exata.
    for (const grid of grids) {
      // A grade pede o texto de cada célula na mesma ordem em que as monta.
      const captured: TextLine[][] = [];
      const { table, used } = buildRuledTable(grid, lines, content.rules, content.fills, (inside) => {
        captured.push(inside);
        return [];
      });
      let next = 0;
      used.forEach((l) => inTable.add(l));
      const colEdges = grid.columns;
      const rows: WCell[][] = [];
      const merges: Item["merges"] = [];
      table.rows.forEach((row, r) => {
        rows[r] ??= [];
        for (const cell of row.cells) {
          const inside = captured[next++] ?? [];
          const c = colEdges.findIndex((x) => Math.abs(x - cell.left) < 1);
          if (c < 0) continue;
          const text = inside.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
          const runs = inside.flatMap((l) => l.runs);
          const bold = runs.length > 0 && runs.every((x) => x.style.bold || !x.text.trim());
          const size = runs.length ? Math.max(...runs.map((x) => x.style.size)) : 11;
          const color = runs.find((x) => x.text.trim())?.style.color ?? { r: 0, g: 0, b: 0 };
          rows[r][c] = cellFor(text, {
            bold, size, color,
            fill: cell.shading ? hex(cell.shading) : null,
            border: true,
            wrap: text.includes("\n"),
          }, decimalComma);
          for (let k = 1; k < cell.span; k++) rows[r][c + k] = { value: null, style: { border: true } };
          if (cell.span > 1 || cell.rowSpan > 1) merges.push({ r1: r, c1: c, r2: r + cell.rowSpan - 1, c2: c + cell.span - 1 });
        }
      });
      const widths = table.columnWidths.map((w) => Math.max(4, w / 5.25));
      items.push({ top: grid.top, rows, merges, widths });
    }

    // O resto: linhas da página, em colunas pelos vãos em branco.
    const free = lines.filter((l) => !inTable.has(l) && !(options.singleSheet && l.artifact));
    const segs = free.map(segmentsOf);
    const bands = columnBands(segs);
    let lastBottom: number | null = null;
    let lastHeight = 0;
    for (let k = 0; k < free.length; k++) {
      const line = free[k];
      const row: WCell[] = [];
      // Vão grande entre linhas (mais de uma linha e meia): uma linha vazia.
      if (lastBottom !== null && line.top - lastBottom > lastHeight * 1.5) items.push({ top: line.top - 0.1, rows: [[]], merges: [], widths: [] });
      for (const seg of segs[k]) {
        const c = bands.length ? bandOf(bands, seg, segs[k].length === 1) : 0;
        const prev = row[c];
        if (prev && typeof prev.value === "string") prev.value += ` ${seg.text}`;
        else row[c] = cellFor(seg.text, seg, decimalComma);
      }
      const widths = bands.map((b) => Math.max(4, (b.right - b.left) / 5.25 + 1.5));
      items.push({ top: line.top, rows: [row], merges: [], widths });
      lastBottom = line.bottom;
      lastHeight = line.bottom - line.top;
    }
    items.sort((a, b) => a.top - b.top);
    pages.push(items);
  }

  report(90, "Gravando o Excel...");
  const toSheet = (name: string, items: Item[]): WSheet => {
    const rows: WSheet["rows"] = [];
    const merges: NonNullable<WSheet["merges"]> = [];
    const widths: number[] = [];
    for (const item of items) {
      const base = rows.length;
      for (const m of item.merges) merges.push({ r1: m.r1 + base, c1: m.c1, r2: m.r2 + base, c2: m.c2 });
      for (const r of item.rows) rows.push(r);
      item.widths.forEach((w, c) => (widths[c] = Math.max(widths[c] ?? 0, w)));
      item.rows.forEach((r) => r.forEach((cell, c) => {
        if (cell && typeof cell.value === "string" && !item.merges.length) widths[c] = Math.max(widths[c] ?? 0, Math.min(charsFor(cell.value), 50));
      }));
    }
    return { name, rows, merges, colWidths: Array.from({ length: widths.length }, (_, c) => Math.max(8.43, widths[c] ?? 8.43)) };
  };
  const sheets: WSheet[] = options.singleSheet
    ? [toSheet("PDF", pages.flat())]
    : pages.map((items, i) => toSheet(`Página ${i + 1}`, items));
  const bytes = await writeXlsx(sheets);
  report(100, "Pronto");
  return { bytes, pages: pageCount, pagesWithoutText };
}
