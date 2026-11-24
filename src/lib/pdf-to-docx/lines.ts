/**
 * Junta os trechos soltos que o PDF desenha em linhas de texto.
 *
 * Um PDF não tem linhas: tem glifos posicionados. O que o pdf.js devolve já vem
 * um pouco agrupado, mas ainda picotado — "Reiterou", "-", "se que o legado..."
 * são três trechos porque o Word trocou de fonte no meio da palavra. Emendar
 * isso é o que separa um Word legível de uma sopa de pedaços.
 *
 * Duas decisões estruturam o módulo:
 *
 * 1. As linhas são formadas por **sobreposição vertical** das caixas dos
 *    glifos, e não por igualdade de linha de base. Assim um expoente, que tem
 *    linha de base diferente, continua na mesma linha do texto que o carrega.
 * 2. Os espaços são **inferidos pela distância**, e não copiados do PDF. O PDF
 *    às vezes desenha o espaço, às vezes só avança o cursor; olhar a distância
 *    funciona nos dois casos e evita espaço dobrado.
 */

import { crossesGutter, type Gutter } from "./layout";
import type { Rgb, TextRun, TextStyle } from "./types";

/** Trecho de texto já dentro de uma linha, com o desvio vertical resolvido. */
export interface LineRun {
  text: string;
  style: TextStyle;
  x: number;
  width: number;
  /** Elevado ou rebaixado em relação à linha de base dominante da linha. */
  vertical: "normal" | "superscript" | "subscript";
  structBlock: number | null;
  /** Destino do link, quando o trecho está sob uma anotação de link do PDF. */
  link?: string;
  underline?: boolean;
  strike?: boolean;
  /** O trecho é o número elevado que chama a nota de rodapé com este id. */
  footnote?: number;
}

export interface TextLine {
  runs: LineRun[];
  text: string;
  /** Borda esquerda do primeiro glifo e direita do último. */
  left: number;
  right: number;
  baseline: number;
  top: number;
  bottom: number;
  /** Corpo dominante da linha, em pontos. */
  fontSize: number;
  artifact: boolean;
  /** Bloco da árvore de estrutura mais frequente na linha. */
  structBlock: number | null;
}

/** Altura acima da linha de base, como fração do corpo. */
const ASCENT = 0.78;
/** Profundidade abaixo da linha de base, como fração do corpo. */
const DESCENT = 0.22;

const sameColor = (a: Rgb, b: Rgb) => a.r === b.r && a.g === b.g && a.b === b.b;

export const sameStyle = (a: TextStyle, b: TextStyle) =>
  a.family === b.family &&
  Math.abs(a.size - b.size) < 0.2 &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  sameColor(a.color, b.color);

const runTop = (r: TextRun) => r.baseline - r.style.size * ASCENT;
const runBottom = (r: TextRun) => r.baseline + r.style.size * DESCENT;

export interface LineSplitOptions {
  /** Rios de espaço em branco entre colunas: nenhuma linha os atravessa. */
  gutters?: Gutter[];
  /**
   * Bordas verticais desenhadas (de célula de tabela): nenhuma linha as
   * atravessa. Sem isso, um total longo encostava na data da coluna vizinha,
   * os dois trechos se fundiam e caíam inteiros numa célula só.
   */
  barriers?: { x: number; top: number; bottom: number }[];
  /**
   * Os dois blocos da árvore de estrutura podem ficar na mesma linha? Rótulo e
   * corpo do mesmo item de lista podem; duas células de tabela, não.
   */
  sameLineBlocks?: (a: number, b: number) => boolean;
}

/**
 * Parte uma faixa de trechos em linhas independentes onde ela atravessa um rio
 * entre colunas ou passa de uma célula de tabela para outra. Sem isso, a linha
 * de uma tabela marcada virava uma linha só, entregue inteira a uma célula, e
 * as duas colunas de um informativo saíam intercaladas.
 */
function splitAcross(group: TextRun[], options: LineSplitOptions): TextRun[][] {
  const { gutters = [], sameLineBlocks, barriers = [] } = options;
  if (!gutters.length && !sameLineBlocks && !barriers.length) return [group];
  const ordered = [...group].sort((a, b) => a.x - b.x);
  const out: TextRun[][] = [];
  let current: TextRun[] = [];
  let reach = -Infinity;
  let block: number | null = null;
  for (const run of ordered) {
    const solid = run.text.trim().length > 0;
    if (current.length && solid) {
      const top = run.baseline - run.style.size * ASCENT;
      const bottom = run.baseline + run.style.size * DESCENT;
      const crosses =
        (gutters.length > 0 && crossesGutter(gutters, reach, run.x, top, bottom)) ||
        barriers.some((b) => b.x > reach - 0.5 && b.x < run.x + 0.5 && b.top < bottom && b.bottom > top);
      const otherBlock =
        sameLineBlocks !== undefined &&
        block !== null &&
        run.structBlock !== null &&
        run.structBlock !== block &&
        !sameLineBlocks(block, run.structBlock);
      if (crosses || otherBlock) {
        out.push(current);
        current = [];
        reach = -Infinity;
        block = null;
      }
    }
    current.push(run);
    if (solid) {
      reach = Math.max(reach, run.x + run.width);
      if (run.structBlock !== null) block = run.structBlock;
    }
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Agrupa os trechos em linhas.
 *
 * Só entram na mesma linha os trechos cujas caixas se sobrepõem na vertical em
 * mais da metade da menor delas. É a mesma regra que o olho usa e ela aguenta
 * corpo misturado, expoente e nota de rodapé sem regra especial. Depois, a
 * faixa é partida onde cruza um rio entre colunas ou uma divisa de célula.
 */
export function groupIntoLines(runs: TextRun[], options: LineSplitOptions = {}): TextLine[] {
  const usable = runs.filter((r) => r.text.length > 0 && r.style.size > 0);
  if (!usable.length) return [];

  const ordered = [...usable].sort((a, b) => a.baseline - b.baseline || a.x - b.x);

  const groups: TextRun[][] = [];
  let current: TextRun[] = [];
  let currentTop = 0;
  let currentBottom = 0;

  for (const run of ordered) {
    const top = runTop(run);
    const bottom = runBottom(run);
    if (!current.length) {
      current = [run];
      currentTop = top;
      currentBottom = bottom;
      continue;
    }

    const overlap = Math.min(currentBottom, bottom) - Math.max(currentTop, top);
    const smaller = Math.min(currentBottom - currentTop, bottom - top);
    if (smaller > 0 && overlap > smaller * 0.5) {
      current.push(run);
      currentTop = Math.min(currentTop, top);
      currentBottom = Math.max(currentBottom, bottom);
    } else {
      groups.push(current);
      current = [run];
      currentTop = top;
      currentBottom = bottom;
    }
  }
  if (current.length) groups.push(current);

  return groups
    .flatMap((group) => splitAcross(group, options))
    .map(buildLine)
    .filter((line): line is TextLine => line !== null);
}

/** Valor mais frequente, com desempate pelo peso acumulado. */
function dominant<T>(items: { value: T; weight: number }[], key: (v: T) => string): T | null {
  const totals = new Map<string, { value: T; weight: number }>();
  for (const item of items) {
    const k = key(item.value);
    const found = totals.get(k);
    if (found) found.weight += item.weight;
    else totals.set(k, { value: item.value, weight: item.weight });
  }
  let best: { value: T; weight: number } | null = null;
  for (const entry of totals.values()) if (!best || entry.weight > best.weight) best = entry;
  return best?.value ?? null;
}

function buildLine(group: TextRun[]): TextLine | null {
  const ordered = [...group].sort((a, b) => a.x - b.x);

  // A linha de base e o corpo dominantes vêm da maior quantidade de texto, e
  // não do primeiro trecho: assim um marcador de nota de rodapé no início da
  // linha não define o corpo da linha inteira.
  const weighted = ordered
    .filter((r) => r.text.trim().length > 0)
    .map((r) => ({ value: r, weight: Math.max(r.width, r.text.trim().length) }));
  const anchor = dominant(weighted, (r) => `${r.baseline.toFixed(1)}|${r.style.size}`) ?? ordered[0];
  const fontSize = anchor.style.size;
  const baseline = anchor.baseline;

  const runsOut: LineRun[] = [];
  let previous: TextRun | null = null;

  // Os trechos que só têm espaço em branco ficam de fora do laço.
  //
  // O pdf.js os devolve com a largura do vão inteiro — o espaço entre duas
  // colunas de tabela chega como um trecho " " de cinquenta pontos de largura.
  // Mantê-los faria a distância entre trechos vizinhos ser sempre zero, e a
  // divisa entre colunas ficaria invisível para o resto do código. O espaço em
  // si não se perde: ele é reposto adiante pela distância entre os trechos.
  const solid = ordered.filter((r) => r.text.trim().length > 0);
  if (!solid.length) return null;

  for (const run of solid) {
    const gap = previous ? run.x - (previous.x + previous.width) : 0;
    const reference = Math.min(previous?.style.size ?? fontSize, run.style.size) || fontSize;

    let text = run.text;

    // Espaço por distância: só quando nenhum dos dois lados já traz um.
    if (previous) {
      const joined = /\s$/.test(runsOut[runsOut.length - 1]?.text ?? "") || /^\s/.test(text);
      if (!joined && gap > reference * 0.16) text = " " + text;
    }

    // Um desvio pequeno da linha de base com corpo menor é expoente ou índice;
    // um desvio grande já teria virado outra linha no agrupamento.
    let vertical: LineRun["vertical"] = "normal";
    const delta = run.baseline - baseline;
    if (run.style.size < fontSize * 0.92 && Math.abs(delta) > fontSize * 0.1) {
      vertical = delta < 0 ? "superscript" : "subscript";
    }

    // Trechos vizinhos de mesmo estilo viram um só, para o Word não receber a
    // linha picotada em dezenas de pedaços. Um vão largo, porém, interrompe a
    // fusão: ali não há palavra nenhuma, há uma tabulação ou a divisa entre
    // duas colunas de tabela. Fundir através dele juntaria "CP-01", "100,2" e
    // "245,8" num trecho só e não haveria mais como saber onde cada coluna
    // começa — o texto sairia igual, mas a tabela inteira cairia numa célula.
    const last = runsOut[runsOut.length - 1];
    const continuous = !previous || gap <= reference * 1.2;

    // Um símbolo solto abrindo a linha é candidato a marcador de lista, e
    // precisa continuar sendo um trecho próprio: é da distância entre ele e a
    // palavra seguinte que sai o recuo pendente do item no Word. Quando a bala
    // vem na mesma fonte do texto — e não em Symbol, como o Word costuma
    // gravar — a fusão por estilo apagaria essa distância.
    // Vale também para número ("1.", "a)", "iv."): é da distância entre ele e
    // o texto que sai o recuo do item numerado.
    const markerLike =
      runsOut.length === 1 &&
      last !== undefined &&
      ((last.text.trim().length === 1 && !/[\p{L}\p{N}]/u.test(last.text.trim())) ||
        /^(\d{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,5})[.)]$/.test(last.text.trim()));
    // Trechos de blocos diferentes da árvore de estrutura (o rótulo de um item
    // de lista e o corpo dele) não se fundem: o rótulo é o marcador.
    const sameBlock = !last || last.structBlock === run.structBlock;

    if (last && continuous && !markerLike && sameBlock && last.vertical === vertical && sameStyle(last.style, run.style)) {
      last.text += text;
      last.width = run.x + run.width - last.x;
    } else {
      runsOut.push({
        text,
        style: run.style,
        x: run.x,
        width: run.width,
        vertical,
        structBlock: run.structBlock,
      });
    }

    previous = run;
  }

  // Trechos que só tinham espaço em branco viram nada de útil sozinhos.
  const cleaned = runsOut.filter((r) => r.text.length > 0);
  if (!cleaned.length) return null;
  const text = cleaned.map((r) => r.text).join("");
  if (!text.trim()) return null;

  const structBlock = dominant(
    cleaned
      .filter((r) => r.structBlock !== null && r.text.trim())
      .map((r) => ({ value: r.structBlock, weight: r.text.trim().length })),
    (v) => String(v),
  );

  // As bordas da linha vêm só do texto visível: um trecho de espaço em branco
  // no fim da linha esticaria a borda direita e faria o alinhamento parecer
  // justificado onde não é.
  const left = Math.min(...solid.map((r) => r.x));
  const right = Math.max(...solid.map((r) => r.x + r.width));

  return {
    runs: cleaned,
    text,
    left,
    right,
    baseline,
    top: Math.min(...solid.map(runTop)),
    bottom: Math.max(...solid.map(runBottom)),
    fontSize,
    artifact: solid.every((r) => r.artifact),
    structBlock: structBlock ?? null,
  };
}

/** Remove o espaço que sobrou nas pontas de uma linha, mantendo os runs. */
export function trimLine(line: TextLine): TextLine {
  const runs = line.runs.map((r) => ({ ...r }));
  while (runs.length && !runs[0].text.trim()) runs.shift();
  if (runs.length) runs[0].text = runs[0].text.replace(/^\s+/, "");
  while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop();
  if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, "");
  return { ...line, runs, text: runs.map((r) => r.text).join("") };
}
