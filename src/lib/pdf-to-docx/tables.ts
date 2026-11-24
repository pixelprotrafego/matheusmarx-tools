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
import type { FilledArea, PlacedImage, Rgb, RuleSegment, StructBlock } from "./types";

export interface CellBorders {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  color: Rgb;
  /** Espessura em pontos. */
  thickness: number;
}

/** Imagem dentro de uma célula: a foto da barra lateral de um currículo. */
export interface CellImage {
  image: PlacedImage;
  alignment: "left" | "center" | "right";
}

export interface TableCell {
  paragraphs: Paragraph[];
  images: CellImage[];
  left: number;
  right: number;
  top: number;
  bottom: number;
  header: boolean;
  borders: CellBorders;
  shading: Rgb | null;
  /** Colunas da grade que a célula ocupa — mais de uma é célula mesclada. */
  span: number;
  /** Linhas que a célula ocupa — mais de uma é mescla vertical. */
  rowSpan: number;
  /** Distância do texto às bordas da célula, em pontos. */
  padding: { left: number; right: number; top: number };
}

export interface TableRow {
  cells: TableCell[];
  top: number;
  bottom: number;
  /**
   * Altura mínima da linha, em pontos. É o que mantém um formulário de pé: a
   * célula vazia de "Observações" tem a altura dela no original, e no Word
   * encolheria para uma linha de texto se a altura não viesse junto.
   */
  height: number | null;
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

/**
 * Existe um traço encostado nesta aresta? Devolve o mais grosso deles.
 *
 * A cobertura é a soma de todos os traços colineares, e não a de um traço só:
 * o Word desenha a borda de cada célula como um pedaço separado, e a aresta de
 * uma célula mesclada sobre três colunas é feita de três pedaços. Exigir um
 * traço único cobrindo a aresta inteira fazia a borda "sumir" ali, e a tabela
 * de um formulário virava uma mescla vertical sem fim.
 */
function edgeRule(
  rules: RuleSegment[],
  axis: "h" | "v",
  position: number,
  from: number,
  to: number,
): RuleSegment | null {
  const tolerance = 2.5;
  let best: RuleSegment | null = null;
  const spans: [number, number][] = [];
  for (const rule of rules) {
    if (rule.axis !== axis) continue;
    if (Math.abs(rule.position - position) > tolerance) continue;
    const a = Math.max(rule.from, from);
    const b = Math.min(rule.to, to);
    if (b <= a) continue;
    spans.push([a, b]);
    if (!best || rule.thickness > best.thickness) best = rule;
  }
  if (!best) return null;
  // União dos trechos cobertos, sem contar duas vezes o que se sobrepõe.
  spans.sort((p, q) => p[0] - q[0]);
  let covered = 0;
  let end = -Infinity;
  for (const [a, b] of spans) {
    if (b <= end) continue;
    covered += b - Math.max(a, end);
    end = b;
  }
  // O traço precisa cobrir a maior parte da aresta, senão é outra coisa que
  // por acaso passa perto.
  return covered >= (to - from) * 0.6 ? best : null;
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

const isNearWhite = (c: Rgb) => c.r > 245 && c.g > 245 && c.b > 245;

/** O menor preenchimento colorido que cobre a caixa inteira, ou `null`. */
export function fillCovering(
  fills: FilledArea[],
  box: { left: number; right: number; top: number; bottom: number },
  slack = 1,
): FilledArea | null {
  let best: FilledArea | null = null;
  for (const f of fills) {
    if (isNearWhite(f.color)) continue;
    const covers =
      f.x <= box.left + slack && f.x + f.width >= box.right - slack &&
      f.y <= box.top + slack && f.y + f.height >= box.bottom - slack;
    if (!covers) continue;
    if (!best || f.width * f.height < best.width * best.height) best = f;
  }
  return best;
}

/** Imagens cujo centro cai dentro da caixa, com o alinhamento dentro dela. */
function imagesIn(images: PlacedImage[], box: { left: number; right: number; top: number; bottom: number }): CellImage[] {
  return images
    .filter((img) => {
      const cx = img.x + img.width / 2;
      const cy = img.y + img.height / 2;
      return cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom;
    })
    .map((image) => {
      const leftGap = image.x - box.left;
      const rightGap = box.right - (image.x + image.width);
      const alignment: CellImage["alignment"] =
        Math.abs(leftGap - rightGap) <= Math.max(4, (box.right - box.left) * 0.05) ? "center"
        : rightGap < leftGap ? "right" : "left";
      return { image, alignment };
    });
}

/**
 * Margem interna da célula: a menor distância entre o texto e as bordas.
 *
 * O texto nunca chega mais perto da borda do que a margem, e encosta nela do
 * lado para onde está alinhado. Num número alinhado à direita, a distância até
 * a borda esquerda é só sobra da coluna — tomá-la como margem, e repeti-la do
 * outro lado, deixava a célula sem espaço, e o Word quebrava "R$ 12,50" letra
 * por letra. O Word usa a mesma margem dos dois lados.
 */
function paddingOf(lines: TextLine[], cell: { left: number; right: number; top: number }) {
  if (!lines.length) return { left: 5.4, right: 5.4, top: 0 };
  const leftGap = Math.min(...lines.map((l) => l.left)) - cell.left;
  const rightGap = cell.right - Math.max(...lines.map((l) => l.right));
  const side = Math.max(0, Math.min(10, leftGap, rightGap));
  const top = Math.max(0, Math.min(30, Math.min(...lines.map((l) => l.top)) - cell.top));
  return { left: side, right: side, top };
}

/**
 * Monta as tabelas descritas pela árvore de estrutura, com a geometria da
 * grade.
 *
 * A árvore diz quais células existem em cada linha — inclusive as vazias, que
 * não têm texto nenhum para medir. A geometria diz onde fica cada uma: o fundo
 * colorido de uma célula dá as bordas exatas dela; sem fundo, a fronteira
 * entre duas células é o meio do vão entre os textos. Uma célula que cobre a
 * região de duas colunas vira célula mesclada.
 *
 * Cada célula recebe os parágrafos medidos contra a caixa dela mesma — e não
 * contra a página, o que antes jogava o texto da coluna da direita de um
 * currículo para um recuo enorme — e as imagens que estão dentro dela.
 */
export function buildStructTables(
  tableLines: TextLine[],
  structBlocks: StructBlock[],
  rules: RuleSegment[],
  fills: FilledArea[],
  images: PlacedImage[],
  makeParagraphs: (lines: TextLine[], box: { left: number; right: number }) => Paragraph[],
  page: { width: number; height: number },
): { tables: DocTable[]; usedImages: Set<PlacedImage> } {
  // Fundo da página inteira não é fundo de célula.
  fills = fills.filter((f) => !(f.width > page.width * 0.9 && f.height > page.height * 0.9));
  const byOrder = new Map(structBlocks.map((b) => [b.order, b]));
  const usedImages = new Set<PlacedImage>();
  const tables: DocTable[] = [];

  // Células lógicas de cada tabela, na ordem da árvore, inclusive as vazias.
  type Logical = { row: number; cell: number; header: boolean; lines: TextLine[] };
  const logicalByTable = new Map<number, Map<number, Logical>>();
  for (const block of structBlocks) {
    if (block.table === null || block.tableRow === null || block.tableCell === null) continue;
    let cells = logicalByTable.get(block.table);
    if (!cells) logicalByTable.set(block.table, (cells = new Map()));
    if (!cells.has(block.tableCell)) {
      cells.set(block.tableCell, { row: block.tableRow, cell: block.tableCell, header: block.role === "TH", lines: [] });
    }
    if (block.role === "TH") cells.get(block.tableCell)!.header = true;
  }
  for (const line of tableLines) {
    const block = line.structBlock !== null ? byOrder.get(line.structBlock) : undefined;
    if (!block || block.table === null || block.tableCell === null) continue;
    logicalByTable.get(block.table)?.get(block.tableCell)?.lines.push(line);
  }

  for (const cellsMap of logicalByTable.values()) {
    const logical = [...cellsMap.values()];
    if (!logical.some((c) => c.lines.length)) continue;
    const rowIds = [...new Set(logical.map((c) => c.row))].sort((a, b) => a - b);
    const rowsLogical = rowIds
      .map((id) => logical.filter((c) => c.row === id).sort((a, b) => a.cell - b.cell))
      .filter((cells) => cells.some((c) => c.lines.length));
    if (!rowsLogical.length) continue;

    const textBox = (c: Logical) =>
      c.lines.length
        ? {
            left: Math.min(...c.lines.map((l) => l.left)),
            right: Math.max(...c.lines.map((l) => l.right)),
            top: Math.min(...c.lines.map((l) => l.top)),
            bottom: Math.max(...c.lines.map((l) => l.bottom)),
          }
        : null;

    // Extensão vertical de cada linha da tabela.
    const rowBounds = rowsLogical.map((cells) => {
      const boxes = cells.map(textBox).filter((b): b is NonNullable<typeof b> => b !== null);
      return { top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)) };
    });

    // Caixa de cada célula com texto: o fundo dela, quando há, ou o texto.
    const cellBox = (c: Logical, r: number) => {
      const t = textBox(c);
      if (!t) return null;
      const fill = fillCovering(fills, t, 2);
      return fill
        ? {
            left: fill.x,
            right: fill.x + fill.width,
            top: Math.min(fill.y, rowBounds[r].top),
            bottom: Math.max(fill.y + fill.height, rowBounds[r].bottom),
            fill,
          }
        : { ...t, fill: null };
    };

    // Fronteiras de coluna: bordas de fundo e meios dos vãos entre células.
    const candidates: number[] = [];
    let tableLeft = Infinity;
    let tableRight = -Infinity;
    rowsLogical.forEach((cells, r) => {
      const boxes = cells.map((c) => cellBox(c, r));
      boxes.forEach((b) => {
        if (!b) return;
        tableLeft = Math.min(tableLeft, b.left);
        tableRight = Math.max(tableRight, b.right);
      });
      for (let i = 1; i < boxes.length; i++) {
        const a = boxes[i - 1];
        const b = boxes[i];
        if (!a || !b) continue;
        candidates.push(a.fill ? a.right : b.fill ? b.left : (a.right + b.left) / 2);
      }
    });
    candidates.sort((a, b) => a - b);
    const inner: number[] = [];
    for (const x of candidates) {
      const last = inner[inner.length - 1];
      if (last !== undefined && x - last < 8) inner[inner.length - 1] = (last + x) / 2;
      else inner.push(x);
    }
    const columns = [tableLeft, ...inner.filter((x) => x > tableLeft + 4 && x < tableRight - 4), tableRight];
    const columnOf = (x: number) => {
      let best = 0;
      for (let i = 0; i < columns.length - 1; i++) if (x >= columns[i] - 4) best = i;
      return best;
    };

    const rows: TableRow[] = rowsLogical.map((cells, r) => {
      const bounds = rowBounds[r];
      const placed = cells.map((c) => ({ c, box: cellBox(c, r) }));
      // Começo de cada célula na grade, pela posição do texto ou do fundo; a
      // vazia herda a coluna logo depois da anterior.
      const starts: number[] = [];
      placed.forEach((p, i) => {
        const fromGeometry = p.box ? columnOf(p.box.left) : -1;
        const afterPrevious = i === 0 ? 0 : starts[i - 1] + 1;
        starts.push(Math.min(columns.length - 2, Math.max(fromGeometry, afterPrevious)));
      });
      const rowTop = Math.min(bounds.top, ...placed.map((p) => p.box?.top ?? Infinity));
      const rowBottom = Math.max(bounds.bottom, ...placed.map((p) => p.box?.bottom ?? -Infinity));
      const out: TableCell[] = placed.map((p, i) => {
        const start = starts[i];
        const end = i + 1 < placed.length ? Math.max(start + 1, starts[i + 1]) : columns.length - 1;
        const box = { left: columns[start], right: columns[end], top: rowTop, bottom: rowBottom };
        const padding = paddingOf(p.c.lines, box);
        const textBounds = { left: box.left + padding.left, right: box.right - padding.right };
        const cellImages = imagesIn(images.filter((img) => !usedImages.has(img)), box);
        cellImages.forEach((ci) => usedImages.add(ci.image));
        return {
          paragraphs: p.c.lines.length ? makeParagraphs(p.c.lines, textBounds) : [],
          images: cellImages,
          ...box,
          header: p.c.header,
          borders: bordersFor(rules, { left: box.left, right: box.right, top: box.top - 2, bottom: box.bottom + 2 }),
          shading: p.box?.fill?.color ?? fillCovering(fills, box, 3)?.color ?? null,
          span: end - start,
          rowSpan: 1,
          padding,
        };
      });
      return { cells: out, top: rowTop, bottom: rowBottom, height: rowBottom - rowTop };
    });

    tables.push({
      rows,
      left: columns[0],
      right: columns[columns.length - 1],
      top: Math.min(...rows.map((r) => r.top)),
      bottom: Math.max(...rows.map((r) => r.bottom)),
      columnWidths: columns.slice(1).map((x, i) => Math.max(8, x - columns[i])),
    });
  }

  return { tables, usedImages };
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

  /** Aplica um filete aos trechos que ele cobre, partindo o trecho nas pontas. */
  const decorate = (run: LineRun, rule: RuleSegment, em: number, baseline: number): LineRun[] => {
    if (!run.text.trim() || run.width <= 0) return [run];
    const from = run.x;
    const to = run.x + run.width;
    const overlap = Math.min(rule.to, to) - Math.max(rule.from, from);
    if (overlap < Math.min(run.width, rule.to - rule.from) * 0.35) return [run];
    const offset = rule.position - baseline;
    const under = offset > em * 0.02 && offset < em * 0.28;
    const strike = offset < -em * 0.18 && offset > -em * 0.45;
    if (!under && !strike) return [run];
    const decoration = under ? { underline: true } : { strike: true };

    const start = indexAt(run, Math.max(rule.from, from));
    const end = indexAt(run, Math.min(rule.to, to));
    if (end <= start) return [run];

    const piece = (text: string, index: number, decorated: boolean): LineRun => ({
      ...run,
      text,
      x: run.x + (index / run.text.length) * run.width,
      width: (text.length / run.text.length) * run.width,
      ...(decorated ? decoration : {}),
    });
    const out: LineRun[] = [];
    if (start > 0) out.push(piece(run.text.slice(0, start), 0, false));
    out.push(piece(run.text.slice(start, end), start, true));
    if (end < run.text.length) out.push(piece(run.text.slice(end), end, false));
    return out;
  };

  // Cada filete é aplicado sobre o resultado do anterior: um trecho com uma
  // palavra sublinhada e outra tachada recebe as duas marcas. Antes, o
  // primeiro filete achado encerrava o trecho, e o tachado se perdia.
  for (const line of lines) {
    const em = line.fontSize || 12;
    for (const rule of horizontals) {
      line.runs = line.runs.flatMap((run) => decorate(run, rule, em, line.baseline));
    }
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
  fills: FilledArea[],
  makeParagraphs: (lines: TextLine[], box: { left: number; right: number }) => Paragraph[],
  images: PlacedImage[] = [],
): { table: DocTable; used: Set<TextLine>; usedImages: Set<PlacedImage> } {
  const used = new Set<TextLine>();
  const usedImages = new Set<PlacedImage>();
  const { columns, rows: rowLines } = grid;
  const nCols = columns.length - 1;
  const nRows = rowLines.length - 1;

  // Tudo o que está dentro da moldura sai do fluxo de texto da página, mesmo
  // que algum trecho não caia em célula nenhuma: repetir esse texto fora da
  // tabela seria pior do que perdê-lo.
  const withinGrid = lines.filter((line) => {
    const cy = (line.top + line.bottom) / 2;
    const overlapsX = line.right >= grid.left - 2 && line.left <= grid.right + 2;
    return overlapsX && cy >= grid.top - 2 && cy <= grid.bottom + 2;
  });
  for (const line of withinGrid) used.add(line);

  // Mescla: falta o traço vertical entre duas colunas numa linha, ou o
  // horizontal entre duas linhas numa coluna. Só vale quando a tabela tem
  // traços internos daquele tipo — numa tabela só com as linhas horizontais,
  // a falta do traço vertical não diz nada.
  const vLine = (c: number, r0: number, r1: number) =>
    edgeRule(rules, "v", columns[c], rowLines[r0], rowLines[r1]) !== null;
  const hLine = (r: number, c0: number, c1: number) =>
    edgeRule(rules, "h", rowLines[r], columns[c0], columns[c1]) !== null;
  let innerV = false;
  for (let c = 1; c < nCols && !innerV; c++) for (let r = 0; r < nRows && !innerV; r++) innerV = vLine(c, r, r + 1);
  let innerH = false;
  for (let r = 1; r < nRows && !innerH; r++) for (let c = 0; c < nCols && !innerH; c++) innerH = hLine(r, c, c + 1);

  const covered: boolean[][] = Array.from({ length: nRows }, () => Array(nCols).fill(false));
  const rowsOut: TableRow[] = [];
  for (let r = 0; r < nRows; r++) {
    const top = rowLines[r];
    const bottomOfRow = rowLines[r + 1];
    if (bottomOfRow - top < 4) continue;
    const cells: TableCell[] = [];
    for (let c = 0; c < nCols; c++) {
      if (covered[r][c]) continue;
      let span = 1;
      while (innerV && c + span < nCols && !vLine(c + span, r, r + 1)) span++;
      let rowSpan = 1;
      while (innerH && r + rowSpan < nRows && !hLine(r + rowSpan, c, c + span)) rowSpan++;
      for (let rr = r; rr < r + rowSpan; rr++) for (let cc = c; cc < c + span; cc++) covered[rr][cc] = true;

      const box = { left: columns[c], right: columns[c + span], top, bottom: rowLines[r + rowSpan] };
      const inside = withinGrid
        .filter((line) => {
          const cy = (line.top + line.bottom) / 2;
          return cy >= box.top - 1 && cy <= box.bottom + 1;
        })
        .map((line) => sliceLine(line, box.left - 1, box.right + 1))
        .filter((line): line is TextLine => line !== null);
      const padding = paddingOf(inside, box);
      const cellImages = imagesIn(images.filter((img) => !usedImages.has(img)), box);
      cellImages.forEach((ci) => usedImages.add(ci.image));

      cells.push({
        paragraphs: makeParagraphs(inside, { left: box.left + Math.max(padding.left, 2), right: box.right - Math.max(padding.right, 2) }),
        images: cellImages,
        ...box,
        header: false,
        borders: bordersFor(rules, box),
        shading: fillCovering(fills, box, 2)?.color ?? null,
        span,
        rowSpan,
        padding,
      });
    }
    rowsOut.push({ cells, top, bottom: bottomOfRow, height: bottomOfRow - top });
  }

  const columnWidths: number[] = [];
  for (let c = 0; c < nCols; c++) columnWidths.push(columns[c + 1] - columns[c]);

  return {
    table: { rows: rowsOut, left: grid.left, right: grid.right, top: grid.top, bottom: grid.bottom, columnWidths },
    used,
    usedImages,
  };
}
