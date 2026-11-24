/**
 * Colunas da página: onde o texto se divide em lados que não se misturam.
 *
 * O agrupamento em linhas junta tudo o que está na mesma altura. Numa página de
 * uma coluna só é isso mesmo que se quer — mas num informativo em duas
 * colunas, num currículo com barra lateral ou numa tabela sem bordas, a mesma
 * altura tem dois textos que nada têm a ver um com o outro. Juntá-los produzia
 * frases alternando entre as colunas, e o texto do Word saía embaralhado.
 *
 * O que separa as colunas é um "rio" de espaço em branco: uma faixa vertical
 * que nenhum texto atravessa, ao longo de várias linhas, com texto dos dois
 * lados. Este módulo encontra esses rios e, a partir deles, divide a página em
 * trechos de fluxo normal e áreas com colunas, na ordem de leitura.
 */

import type { TextLine } from "./lines";
import type { TextRun } from "./types";

/** Faixa vertical vazia entre duas colunas. */
export interface Gutter {
  /** Bordas do espaço em branco. */
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

/** Uma coluna de uma área. */
export interface AreaColumn {
  left: number;
  right: number;
  lines: TextLine[];
}

/** Trecho da página na ordem de leitura. */
export type PageSegment =
  | { kind: "flow"; lines: TextLine[]; top: number; bottom: number }
  | { kind: "columns"; columns: AreaColumn[]; top: number; bottom: number; left: number; right: number };

interface Box {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  text: string;
}

const ASCENT = 0.78;
const DESCENT = 0.22;

const boxOf = (run: TextRun): Box => ({
  x0: run.x,
  x1: run.x + Math.max(run.width, 0.5),
  top: run.baseline - run.style.size * ASCENT,
  bottom: run.baseline + run.style.size * DESCENT,
  text: run.text.trim(),
});

/** Faixas horizontais de texto, por sobreposição vertical (o "pré-linha"). */
function clusterRows(boxes: Box[]): Box[][] {
  const sorted = [...boxes].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const rows: { boxes: Box[]; top: number; bottom: number }[] = [];
  for (const box of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const overlap = Math.min(row.bottom, box.bottom) - Math.max(row.top, box.top);
      const smaller = Math.min(row.bottom - row.top, box.bottom - box.top);
      if (smaller > 0 && overlap > smaller * 0.5) {
        row.boxes.push(box);
        row.top = Math.min(row.top, box.top);
        row.bottom = Math.max(row.bottom, box.bottom);
        continue;
      }
    }
    rows.push({ boxes: [box], top: box.top, bottom: box.bottom });
  }
  return rows.map((r) => r.boxes.sort((a, b) => a.x0 - b.x0));
}

/** Marcador de lista solto: bala, número ou letra com pontuação. */
const MARKER = /^([•◦▪▫‣⁃●○■□◆◇·»–—\-*§¨Øü]|\d{1,3}[.)]?|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{1,5}[.)])$/;

const median = (values: number[]) => {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/**
 * Encontra os rios de espaço em branco da página.
 *
 * Cada vão largo entre dois trechos de uma mesma faixa é uma semente; ela cresce
 * para cima e para baixo enquanto nenhum trecho atravessar a faixa vazia — um
 * trecho que só encosta na borda estreita a faixa, um que a atravessa encerra o
 * crescimento. O rio só vale com texto dos dois lados em várias linhas, e
 * nunca quando o lado esquerdo é só marcador de lista: o vão entre a bala e o
 * texto de uma lista também é um rio, mas separá-los destruiria a lista.
 */
export function findGutters(
  runs: TextRun[],
  /**
   * Regiões que bloqueiam o rio sem gerar rio: as tabelas, que têm caminho
   * próprio. Tirá-las da conta deixava o rio atravessar a tabela como se ela
   * não existisse, e o título acima dela virava coluna do texto abaixo.
   */
  obstacles: { left: number; right: number; top: number; bottom: number }[] = [],
): Gutter[] {
  const boxes = runs.filter((r) => r.text.trim() && r.style.size > 0).map(boxOf);
  if (boxes.length < 6) return [];
  const blockers: Box[] = obstacles.map((o) => ({ x0: o.left, x1: o.right, top: o.top, bottom: o.bottom, text: "" }));
  const rows = clusterRows([...boxes, ...blockers]);
  const em = median(boxes.map((b) => b.bottom - b.top)) || 12;
  const minGap = Math.max(9, em * 0.75);
  const minLines = 3;

  const found: (Gutter & { first: number; last: number })[] = [];

  /** O trecho atravessa a faixa? Devolve a faixa encolhida ou `null`. */
  const squeeze = (row: Box[], a: number, b: number): [number, number] | null => {
    let lo = a;
    let hi = b;
    for (const box of row) {
      if (box.x1 <= lo || box.x0 >= hi) continue;
      const leftPart = box.x0 <= lo;
      const rightPart = box.x1 >= hi;
      if (leftPart && rightPart) return null;
      if (leftPart) lo = box.x1;
      else if (rightPart) hi = box.x0;
      // Trecho inteiro dentro da faixa: fica do lado mais próximo.
      else if (box.x0 - lo < hi - box.x1) lo = box.x1;
      else hi = box.x0;
      if (hi - lo < minGap) return null;
    }
    return [lo, hi];
  };

  rows.forEach((row, k) => {
    for (let i = 1; i < row.length; i++) {
      // Obstáculo não é texto: não semeia rio de nenhum dos lados.
      if (!row[i].text || !row[i - 1].text) continue;
      const a0 = Math.max(...row.slice(0, i).map((b) => b.x1));
      const b0 = row[i].x0;
      if (b0 - a0 < minGap) continue;
      let a = a0;
      let b = b0;
      let first = k;
      let last = k;
      // Coluna é texto contínuo: um vão vertical grande encerra o rio. Sem
      // isso, a data alinhada à direita acima das assinaturas de um contrato
      // entrava na "coluna" da assinatura da direita. As imagens contam como
      // conteúdo (entram como obstáculo), para o gráfico no meio de uma coluna
      // de um informativo não abrir esse vão.
      const maxGap = Math.max(24, em * 2.5);
      const top = (row: Box[]) => Math.min(...row.map((x) => x.top));
      const bottom = (row: Box[]) => Math.max(...row.map((x) => x.bottom));
      for (let m = k + 1; m < rows.length; m++) {
        if (top(rows[m]) - bottom(rows[m - 1]) > maxGap) break;
        const next = squeeze(rows[m], a, b);
        if (!next) break;
        [a, b] = next;
        last = m;
      }
      for (let m = k - 1; m >= 0; m--) {
        if (top(rows[m + 1]) - bottom(rows[m]) > maxGap) break;
        const next = squeeze(rows[m], a, b);
        if (!next) break;
        [a, b] = next;
        first = m;
      }
      if (found.some((g) => g.first === first && g.last === last && Math.min(g.x1, b) - Math.max(g.x0, a) > 0)) continue;
      found.push({ x0: a, x1: b, first, last, top: rows[first][0].top, bottom: 0 });
    }
  });

  const gutters: Gutter[] = [];
  for (const g of found) {
    const span = rows.slice(g.first, g.last + 1).map((row) => row.filter((box) => box.text));
    const leftRows = span.filter((row) => row.some((box) => box.x1 <= g.x0 + 0.5));
    const rightRows = span.filter((row) => row.some((box) => box.x0 >= g.x1 - 0.5));
    if (leftRows.length < minLines || rightRows.length < minLines) continue;
    // Lado esquerdo feito só de marcadores: é uma lista, não uma coluna.
    const leftTexts = span.flatMap((row) => row.filter((box) => box.x1 <= g.x0 + 0.5)).map((b) => b.text);
    const nearestLeft = span.flatMap((row) => {
      const left = row.filter((box) => box.x1 <= g.x0 + 0.5);
      return left.length ? [left[left.length - 1].text] : [];
    });
    if (nearestLeft.length && nearestLeft.every((t) => MARKER.test(t))) continue;
    if (leftTexts.every((t) => MARKER.test(t))) continue;
    const top = Math.min(...span.filter((row) => row.length).map((row) => Math.min(...row.map((b) => b.top))));
    const bottom = Math.max(...span.filter((row) => row.length).map((row) => Math.max(...row.map((b) => b.bottom))));
    // Coluna de verdade é texto denso dos dois lados. Três linhas soltas,
    // espalhadas por meia página, só deixam um vão por acaso: o "Data" e o
    // "Assinatura" no pé de um formulário não são duas colunas.
    const dense = (sideRows: Box[][]) => {
      const covered = sideRows.reduce((sum, row) => sum + (Math.max(...row.map((b) => b.bottom)) - Math.min(...row.map((b) => b.top))), 0);
      const extent = Math.max(...sideRows.map((row) => Math.max(...row.map((b) => b.bottom)))) - Math.min(...sideRows.map((row) => Math.min(...row.map((b) => b.top))));
      return extent > 0 && covered / extent >= 0.35;
    };
    const leftSide = leftRows.map((row) => row.filter((box) => box.x1 <= g.x0 + 0.5));
    const rightSide = rightRows.map((row) => row.filter((box) => box.x0 >= g.x1 - 0.5));
    if (!dense(leftSide) || !dense(rightSide)) continue;
    gutters.push({ x0: g.x0, x1: g.x1, top, bottom });
  }

  // Sementes diferentes do mesmo rio dão faixas quase iguais: fica a mais alta.
  gutters.sort((a, b) => b.bottom - b.top - (a.bottom - a.top));
  const unique: Gutter[] = [];
  for (const g of gutters) {
    const dup = unique.some(
      (u) => Math.min(u.x1, g.x1) - Math.max(u.x0, g.x0) > 0 && Math.min(u.bottom, g.bottom) - Math.max(u.top, g.top) > 0,
    );
    if (!dup) unique.push(g);
  }
  return unique.sort((a, b) => a.top - b.top || a.x0 - b.x0);
}

/** O trecho de texto entre `from` e `to` (horizontais) atravessa algum rio? */
export function crossesGutter(gutters: Gutter[], from: number, to: number, top: number, bottom: number): boolean {
  for (const g of gutters) {
    if (bottom <= g.top || top >= g.bottom) continue;
    if (from <= g.x0 + 0.5 && to >= g.x1 - 0.5) return true;
  }
  return false;
}

/**
 * Divide as linhas do corpo em trechos de fluxo normal e áreas com colunas,
 * na ordem de leitura: de cima para baixo, e dentro de uma área, coluna por
 * coluna da esquerda para a direita.
 */
export function partitionPage(lines: TextLine[], gutters: Gutter[]): PageSegment[] {
  if (!gutters.length) {
    return lines.length ? [{ kind: "flow", lines, top: Math.min(...lines.map((l) => l.top)), bottom: Math.max(...lines.map((l) => l.bottom)) }] : [];
  }

  // Rios que se sobrepõem na vertical formam uma área só.
  const sorted = [...gutters].sort((a, b) => a.top - b.top);
  const areas: { top: number; bottom: number; gutters: Gutter[] }[] = [];
  for (const g of sorted) {
    const area = areas.find((a) => g.top < a.bottom && g.bottom > a.top);
    if (area) {
      area.gutters.push(g);
      area.top = Math.min(area.top, g.top);
      area.bottom = Math.max(area.bottom, g.bottom);
    } else {
      areas.push({ top: g.top, bottom: g.bottom, gutters: [g] });
    }
  }

  const inArea = (line: TextLine, area: { top: number; bottom: number }) => {
    const mid = (line.top + line.bottom) / 2;
    return mid >= area.top && mid <= area.bottom;
  };

  const segments: PageSegment[] = [];
  const free = lines.filter((l) => !areas.some((a) => inArea(l, a)));
  for (const area of areas) {
    const members = lines.filter((l) => inArea(l, area));
    if (!members.length) continue;
    const cuts = area.gutters.map((g) => (g.x0 + g.x1) / 2).sort((a, b) => a - b);
    const columns: AreaColumn[] = [];
    for (let c = 0; c <= cuts.length; c++) {
      const lo = c === 0 ? -Infinity : cuts[c - 1];
      const hi = c === cuts.length ? Infinity : cuts[c];
      const colLines = members.filter((l) => {
        const center = (l.left + l.right) / 2;
        return center >= lo && center < hi;
      });
      if (!colLines.length) continue;
      columns.push({
        left: Math.min(...colLines.map((l) => l.left)),
        right: Math.max(...colLines.map((l) => l.right)),
        lines: colLines.sort((a, b) => a.baseline - b.baseline || a.left - b.left),
      });
    }
    // Uma coluna só não é área: é fluxo normal que por acaso teve um vão.
    if (columns.length < 2) {
      free.push(...members);
      continue;
    }
    segments.push({
      kind: "columns",
      columns,
      top: Math.min(...members.map((l) => l.top)),
      bottom: Math.max(...members.map((l) => l.bottom)),
      left: Math.min(...columns.map((c) => c.left)),
      right: Math.max(...columns.map((c) => c.right)),
    });
  }

  // O fluxo livre é partido onde uma área se intercala, para a ordem de
  // leitura ficar certa: o que vem antes da área, a área, o que vem depois.
  free.sort((a, b) => a.baseline - b.baseline || a.left - b.left);
  const areaSegments = segments.slice().sort((a, b) => a.top - b.top);
  let current: TextLine[] = [];
  const flows: PageSegment[] = [];
  const flush = () => {
    if (!current.length) return;
    flows.push({ kind: "flow", lines: current, top: Math.min(...current.map((l) => l.top)), bottom: Math.max(...current.map((l) => l.bottom)) });
    current = [];
  };
  let areaIndex = 0;
  for (const line of free) {
    while (areaIndex < areaSegments.length && areaSegments[areaIndex].top < line.top) {
      flush();
      areaIndex++;
    }
    current.push(line);
  }
  flush();

  return [...flows, ...segments].sort((a, b) => a.top - b.top);
}
