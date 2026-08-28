/**
 * Reconstrução de tabelas e de sublinhado.
 *
 * O PDF não guarda tabela: guarda texto em posições e traços desenhados por
 * cima. Recuperar a tabela é o que separa um documento editável de uma pilha de
 * parágrafos soltos com espaços no lugar das colunas.
 *
 * Como na montagem dos parágrafos, há dois caminhos. Quando o PDF é marcado, a
 * árvore diz exatamente quais parágrafos são de qual célula, e aqui só falta
 * medir a geometria para achar as larguras e as bordas. Sem a árvore, a grade é
 * deduzida dos traços — o que só é tentado quando eles formam um retângulo
 * fechado com pelo menos duas colunas, porque um filete solto embaixo de um
 * título não é tabela e virar tabela seria pior do que não virar.
 */

import type { Paragraph } from "./blocks";
import type { LineRun, TextLine } from "./lines";
import type { Rgb, RuleSegment } from "./types";

export interface CellBorders {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  color: Rgb;
  /** Espessura em pontos. */
  thickness: number;
}

export interface TableCell {
  paragraphs: Paragraph[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  header: boolean;
  borders: CellBorders;
  shading: Rgb | null;
}

export interface TableRow {
  cells: TableCell[];
  top: number;
  bottom: number;
}

export interface DocTable {
  rows: TableRow[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Larguras das colunas em pontos, já normalizadas para somar a largura. */
  columnWidths: number[];
}

const NO_BORDERS: CellBorders = {
  top: false, right: false, bottom: false, left: false,
  color: { r: 0, g: 0, b: 0 }, thickness: 0.5,
};

/** Existe um traço encostado nesta aresta? */
function edgeRule(
  rules: RuleSegment[],
  axis: "h" | "v",
  position: number,
  from: number,
  to: number,
): RuleSegment | null {
  const tolerance = 2.5;
  let best: RuleSegment | null = null;
  for (const rule of rules) {
    if (rule.axis !== axis) continue;
    if (Math.abs(rule.position - position) > tolerance) continue;
    // O traço precisa cobrir a maior parte da aresta, senão é outra coisa que
    // por acaso passa perto.
    const overlap = Math.min(rule.to, to) - Math.max(rule.from, from);
    if (overlap < (to - from) * 0.6) continue;
    if (!best || rule.thickness > best.thickness) best = rule;
  }
  return best;
}

function bordersFor(
  rules: RuleSegment[],
  cell: { left: number; right: number; top: number; bottom: number },
): CellBorders {
  const top = edgeRule(rules, "h", cell.top, cell.left, cell.right);
  const bottom = edgeRule(rules, "h", cell.bottom, cell.left, cell.right);
  const left = edgeRule(rules, "v", cell.left, cell.top, cell.bottom);
  const right = edgeRule(rules, "v", cell.right, cell.top, cell.bottom);
  const found = [top, bottom, left, right].filter(Boolean) as RuleSegment[];
  if (!found.length) return { ...NO_BORDERS };
  return {
    top: Boolean(top),
    right: Boolean(right),
    bottom: Boolean(bottom),
    left: Boolean(left),
    color: found[0].color,
    thickness: Math.max(0.5, Math.min(...found.map((f) => f.thickness))),
  };
}

const boundsOf = (paragraphs: Paragraph[]) => ({
  left: Math.min(...paragraphs.flatMap((p) => p.lines.map((l) => l.left))),
  right: Math.max(...paragraphs.flatMap((p) => p.lines.map((l) => l.right))),
  top: Math.min(...paragraphs.map((p) => p.top)),
  bottom: Math.max(...paragraphs.map((p) => p.bottom)),
});

/**
 * Monta as tabelas descritas pela árvore de estrutura.
 *
 * Devolve as tabelas e os parágrafos que sobraram, em ordem, para o chamador
 * intercalar os dois no documento.
 */
export function buildStructTables(
  paragraphs: Paragraph[],
  rules: RuleSegment[],
  fills: { x: number; y: number; width: number; height: number; color: Rgb }[],
): { tables: Map<number, DocTable>; loose: Paragraph[] } {
  const tables = new Map<number, DocTable>();
  const loose: Paragraph[] = [];

  const grouped = new Map<number, Paragraph[]>();
  for (const paragraph of paragraphs) {
    if (paragraph.table === null || paragraph.tableCell === null) {
      loose.push(paragraph);
      continue;
    }
    const list = grouped.get(paragraph.table);
    if (list) list.push(paragraph);
    else grouped.set(paragraph.table, [paragraph]);
  }

  for (const [tableId, members] of grouped) {
    const rowIds = [...new Set(members.map((p) => p.tableRow ?? -1))].sort((a, b) => a - b);
    const rows: TableRow[] = [];

    for (const rowId of rowIds) {
      const inRow = members.filter((p) => (p.tableRow ?? -1) === rowId);
      const cellIds = [...new Set(inRow.map((p) => p.tableCell ?? -1))].sort((a, b) => a - b);

      const cells: TableCell[] = cellIds.map((cellId) => {
        const inCell = inRow.filter((p) => (p.tableCell ?? -1) === cellId);
        const box = boundsOf(inCell);
        // A caixa do texto é menor que a da célula; as bordas são procuradas
        // com uma folga para fora, que é onde o traço realmente está.
        const probe = { left: box.left - 6, right: box.right + 6, top: box.top - 4, bottom: box.bottom + 4 };
        const shade = fills.find(
          (f) =>
            f.x <= box.left + 2 && f.x + f.width >= box.right - 2 &&
            f.y <= box.top + 2 && f.y + f.height >= box.bottom - 2,
        );
        return {
          paragraphs: inCell,
          ...box,
          header: inCell.some((p) => p.headerCell),
          borders: bordersFor(rules, probe),
          shading: shade ? shade.color : null,
        };
      });

      if (!cells.length) continue;
      rows.push({
        cells,
        top: Math.min(...cells.map((c) => c.top)),
        bottom: Math.max(...cells.map((c) => c.bottom)),
      });
    }

    if (!rows.length) continue;

    const left = Math.min(...rows.flatMap((r) => r.cells.map((c) => c.left)));
    const right = Math.max(...rows.flatMap((r) => r.cells.map((c) => c.right)));
    tables.set(tableId, {
      rows,
      left,
      right,
      top: Math.min(...rows.map((r) => r.top)),
      bottom: Math.max(...rows.map((r) => r.bottom)),
      columnWidths: columnWidthsOf(rows, left, right),
    });
  }

  return { tables, loose };
}

/**
 * Larguras das colunas a partir das caixas de texto das células.
 *
 * Usa a linha com mais células como régua: é a que mostra a divisão real da
 * tabela. Linhas com menos células (uma mesclada, por exemplo) distorceriam a
 * medida se entrassem na conta.
 */
function columnWidthsOf(rows: TableRow[], left: number, right: number): number[] {
  const widest = rows.reduce((a, b) => (b.cells.length > a.cells.length ? b : a), rows[0]);
  const count = widest.cells.length;
  if (count <= 1) return [right - left];

  const widths: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = i === 0 ? left : (widest.cells[i].left + widest.cells[i - 1].right) / 2;
    const end = i === count - 1 ? right : (widest.cells[i].right + widest.cells[i + 1].left) / 2;
    widths.push(Math.max(end - start, 8));
  }

  // Normaliza para a soma bater com a largura da tabela, senão o Word estica a
  // última coluna e a tabela sai mais larga que o original.
  const total = widths.reduce((a, b) => a + b, 0);
  const target = right - left;
  return widths.map((w) => (w / total) * target);
}

/**
 * Marca como sublinhado ou tachado os trechos com um filete na altura certa.
 *
 * O PDF não tem atributo de sublinhado: quem sublinha desenha uma linha por
 * baixo das letras. A altura em relação à linha de base é o que separa um
 * sublinhado de um traço decorativo qualquer, e a faixa horizontal do filete
 * diz quais palavras estão sublinhadas.
 *
 * Como o filete quase nunca cobre um trecho inteiro — sublinha-se um pedaço da
 * frase, não a frase toda —, o trecho é **partido** onde o filete começa e
 * termina. Sem partir, ou o sublinhado se perde ou ele contamina a linha
 * inteira, e os dois resultados estão errados.
 *
 * O corte é proporcional à largura, encostado na fronteira de palavra mais
 * próxima: não há como saber a largura de cada letra a partir do que o pdf.js
 * devolve, mas errar meia letra e acertar a palavra é o bastante.
 */
export function applyRuleDecorations(lines: TextLine[], rules: RuleSegment[]): void {
  const horizontals = rules.filter((r) => r.axis === "h" && r.thickness <= 2.5);
  if (!horizontals.length) return;

  /** Índice do caractere mais próximo de `x`, preferindo fronteira de palavra. */
  const indexAt = (run: LineRun, x: number): number => {
    if (run.width <= 0) return 0;
    const raw = ((x - run.x) / run.width) * run.text.length;
    const rounded = Math.max(0, Math.min(run.text.length, Math.round(raw)));
    for (let d = 0; d <= 2; d++) {
      for (const i of [rounded - d, rounded + d]) {
        if (i < 0 || i > run.text.length) continue;
        const before = i === 0 ? " " : run.text[i - 1];
        const after = i === run.text.length ? " " : run.text[i];
        if (/\s/.test(before) !== /\s/.test(after) || /\s/.test(before)) return i;
      }
    }
    return rounded;
  };

  for (const line of lines) {
    const em = line.fontSize || 12;
    const out: LineRun[] = [];

    for (const run of line.runs) {
      if (!run.text.trim() || run.width <= 0) {
        out.push(run);
        continue;
      }

      const from = run.x;
      const to = run.x + run.width;
      const hit = horizontals.find((rule) => {
        const overlap = Math.min(rule.to, to) - Math.max(rule.from, from);
        if (overlap < Math.min(run.width, rule.to - rule.from) * 0.35) return false;
        const offset = rule.position - line.baseline;
        return (offset > em * 0.02 && offset < em * 0.28) || (offset < -em * 0.18 && offset > -em * 0.45);
      });

      if (!hit) {
        out.push(run);
        continue;
      }

      const offset = hit.position - line.baseline;
      const decoration = offset > 0 ? { underline: true } : { strike: true };

      const start = indexAt(run, Math.max(hit.from, from));
      const end = indexAt(run, Math.min(hit.to, to));
      if (end <= start) {
        out.push(run);
        continue;
      }

      const piece = (text: string, index: number, decorated: boolean): LineRun => ({
        ...run,
        text,
        x: run.x + (index / run.text.length) * run.width,
        width: (text.length / run.text.length) * run.width,
        ...(decorated ? decoration : {}),
      });

      if (start > 0) out.push(piece(run.text.slice(0, start), 0, false));
      out.push(piece(run.text.slice(start, end), start, true));
      if (end < run.text.length) out.push(piece(run.text.slice(end), end, false));
    }

    line.runs = out;
  }
}

/** Agrupa valores próximos num único valor, para tolerar meio ponto de erro. */
const clusterPositions = (values: number[], tolerance = 3): number[] => {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let bucket: number[] = [];
  for (const v of sorted) {
    if (!bucket.length || v - bucket[bucket.length - 1] <= tolerance) bucket.push(v);
    else {
      out.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);
      bucket = [v];
    }
  }
  if (bucket.length) out.push(bucket.reduce((a, b) => a + b, 0) / bucket.length);
  return out;
};

/** Retângulo que envolve um traço. */
const ruleBox = (r: RuleSegment) =>
  r.axis === "h"
    ? { left: r.from, right: r.to, top: r.position, bottom: r.position }
    : { left: r.position, right: r.position, top: r.from, bottom: r.to };

/** Grade de uma tabela deduzida dos traços. */
export interface RuledGrid {
  /** Fronteiras verticais, da esquerda para a direita. */
  columns: number[];
  /** Fronteiras horizontais, de cima para baixo. */
  rows: number[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Encontra as grades desenhadas na página, para PDFs sem árvore de estrutura.
 *
 * Os traços são primeiro separados em grupos que se tocam, para duas tabelas na
 * mesma página não virarem uma só. Cada grupo só é aceito como tabela se
 * formar uma grade fechada — duas fronteiras horizontais e duas verticais que
 * se cruzam. Um filete solto sob um título ou uma régua separando seções
 * passariam num teste mais frouxo, e transformar texto corrido em tabela
 * estraga o documento bem mais do que deixar de reconhecer uma.
 */
export function detectRuledGrids(rules: RuleSegment[]): RuledGrid[] {
  const useful = rules.filter(
    (r) => (r.axis === "h" && r.to - r.from > 18) || (r.axis === "v" && r.to - r.from > 6),
  );
  if (useful.length < 4) return [];

  // Componentes conexas: dois traços pertencem à mesma tabela quando suas
  // caixas se tocam, com uma folga para a espessura do traço.
  const parent = useful.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  const boxes = useful.map(ruleBox);
  const slack = 3;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const touches =
        a.left - slack <= b.right && b.left - slack <= a.right &&
        a.top - slack <= b.bottom && b.top - slack <= a.bottom;
      if (touches) union(i, j);
    }
  }

  const groups = new Map<number, RuleSegment[]>();
  useful.forEach((rule, i) => {
    const key = find(i);
    const list = groups.get(key);
    if (list) list.push(rule);
    else groups.set(key, [rule]);
  });

  const grids: RuledGrid[] = [];
  for (const group of groups.values()) {
    const horizontals = group.filter((r) => r.axis === "h");
    const verticals = group.filter((r) => r.axis === "v");
    if (horizontals.length < 2 || verticals.length < 2) continue;

    const rows = clusterPositions(horizontals.map((r) => r.position));
    const columns = clusterPositions(verticals.map((r) => r.position));
    if (rows.length < 2 || columns.length < 2) continue;

    const top = rows[0];
    const bottom = rows[rows.length - 1];
    const left = columns[0];
    const right = columns[columns.length - 1];
    if (bottom - top < 8 || right - left < 30) continue;

    grids.push({ columns, rows, left, right, top, bottom });
  }

  return grids.sort((a, b) => a.top - b.top);
}

/**
 * Distribui as linhas de texto pelas células da grade e monta a tabela.
 *
 * Devolve também as linhas que ficaram de fora, para o chamador seguir
 * tratando-as como texto normal da página.
 */
/**
 * Recorta de uma linha só os trechos que caem entre duas colunas.
 *
 * Uma linha de tabela atravessa a fileira inteira: "CP-01", "100,2", "245,8" e
 * "31,2" estão todos na mesma linha de base e o agrupamento os juntou num
 * único objeto. Sem recortar por coluna, a fileira toda cairia numa célula só —
 * que foi exatamente o que aconteceu na primeira versão.
 */
const sliceLine = (line: TextLine, left: number, right: number): TextLine | null => {
  const runs = line.runs.filter((run) => {
    const center = run.x + run.width / 2;
    return center >= left && center <= right;
  });
  if (!runs.length) return null;
  const text = runs.map((r) => r.text).join("");
  if (!text.trim()) return null;
  return {
    ...line,
    runs,
    text,
    left: Math.min(...runs.map((r) => r.x)),
    right: Math.max(...runs.map((r) => r.x + r.width)),
  };
};

export function buildRuledTable(
  grid: RuledGrid,
  lines: TextLine[],
  rules: RuleSegment[],
  fills: { x: number; y: number; width: number; height: number; color: Rgb }[],
  makeParagraphs: (lines: TextLine[], box: { left: number; right: number }) => Paragraph[],
): { table: DocTable; used: Set<TextLine> } {
  const used = new Set<TextLine>();
  const rowsOut: TableRow[] = [];

  // Tudo o que está dentro da moldura sai do fluxo de texto da página, mesmo
  // que algum trecho não caia em célula nenhuma: repetir esse texto fora da
  // tabela seria pior do que perdê-lo.
  const withinGrid = lines.filter((line) => {
    const cy = (line.top + line.bottom) / 2;
    const overlapsX = line.right >= grid.left - 2 && line.left <= grid.right + 2;
    return overlapsX && cy >= grid.top - 2 && cy <= grid.bottom + 2;
  });
  for (const line of withinGrid) used.add(line);

  for (let r = 0; r < grid.rows.length - 1; r++) {
    const top = grid.rows[r];
    const bottom = grid.rows[r + 1];
    if (bottom - top < 4) continue;

    const inRow = withinGrid.filter((line) => {
      const cy = (line.top + line.bottom) / 2;
      return cy >= top - 1 && cy <= bottom + 1;
    });

    const cells: TableCell[] = [];
    for (let c = 0; c < grid.columns.length - 1; c++) {
      const left = grid.columns[c];
      const right = grid.columns[c + 1];

      const inside = inRow
        .map((line) => sliceLine(line, left - 1, right + 1))
        .filter((line): line is TextLine => line !== null);

      const box = { left: left + 2, right: right - 2 };
      const shade = fills.find(
        (f) =>
          f.x <= left + 2 && f.x + f.width >= right - 2 &&
          f.y <= top + 2 && f.y + f.height >= bottom - 2 &&
          !(f.color.r > 250 && f.color.g > 250 && f.color.b > 250),
      );

      cells.push({
        paragraphs: makeParagraphs(inside, box),
        left, right, top, bottom,
        header: false,
        borders: bordersFor(rules, { left, right, top, bottom }),
        shading: shade ? shade.color : null,
      });
    }

    if (cells.length) rowsOut.push({ cells, top, bottom });
  }

  const columnWidths: number[] = [];
  for (let c = 0; c < grid.columns.length - 1; c++) {
    columnWidths.push(grid.columns[c + 1] - grid.columns[c]);
  }

  return {
    table: {
      rows: rowsOut,
      left: grid.left,
      right: grid.right,
      top: grid.top,
      bottom: grid.bottom,
      columnWidths,
    },
    used,
  };
}
