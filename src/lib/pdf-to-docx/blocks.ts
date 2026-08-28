/**
 * Agrupa linhas em parágrafos e deduz a formatação de parágrafo.
 *
 * Há dois caminhos, e a diferença entre eles é grande:
 *
 * - **Com árvore de estrutura**, o próprio PDF diz onde começa e termina cada
 *   parágrafo, o que é item de lista e o que é célula. Foi o Word que gravou
 *   isso ao exportar, então é a intenção original do documento, não um palpite.
 * - **Sem árvore** (PDF de scanner, de gerador antigo, de impressora virtual),
 *   sobra a geometria: distância entre linhas, recuo e onde a linha termina.
 *
 * Alinhamento, recuo e espaçamento saem da geometria nos dois casos — nem o PDF
 * marcado guarda isso, porque no PDF tudo já está posicionado.
 */

import type { TextLine } from "./lines";
import { trimLine } from "./lines";
import type { StructBlock } from "./types";

export type Alignment = "left" | "center" | "right" | "justify";

export interface ListInfo {
  kind: "bullet" | "number";
  /** Nível de aninhamento, começando em zero. */
  level: number;
  /** Texto do marcador, como aparece no PDF. */
  marker: string;
  /**
   * Onde o marcador começa, em pontos a partir da margem esquerda. O recuo
   * pendente do Word é a distância entre este ponto e o início do texto — sem
   * ele o marcador cola no texto ou fica longe demais dele.
   */
  markerIndent: number;
  /**
   * Fonte em que o marcador foi desenhado. O Word grava as balas em Symbol ou
   * Wingdings, onde o mesmo código de caractere desenha outro símbolo — anotar
   * a fonte junto é o que faz a bala reaparecer com o desenho certo.
   */
  markerFont: string;
  /** Identidade do item na árvore de estrutura, quando existe. */
  structItem: number | null;
}

export interface Paragraph {
  lines: TextLine[];
  alignment: Alignment;
  /** Recuos em pontos, relativos à caixa de conteúdo da página. */
  indentLeft: number;
  indentRight: number;
  indentFirstLine: number;
  /** Entrelinha em pontos: distância entre linhas de base dentro do parágrafo. */
  lineSpacing: number;
  /** Espaço depois do parágrafo, em pontos. */
  spaceAfter: number;
  /**
   * Espaço antes do parágrafo, em pontos. Fica em zero em quase todo lugar,
   * porque o vão entre dois parágrafos é sempre atribuído ao "depois" do
   * primeiro; só o parágrafo que abre uma página não tem um anterior de onde
   * herdar esse vão, e é nele que este campo é usado.
   */
  spaceBefore: number;
  list: ListInfo | null;
  /** 0 = texto normal; 1..6 = título de nível N. */
  outlineLevel: number;
  top: number;
  bottom: number;
  /** Tabela, linha e célula a que este parágrafo pertence, quando há. */
  table: number | null;
  tableRow: number | null;
  tableCell: number | null;
  /** `TH` da árvore de estrutura: célula de cabeçalho da tabela. */
  headerCell: boolean;
  /** Termina numa linha cheia, o que sugere que o texto continua adiante. */
  endsFull: boolean;
}

/** Caixa útil da página, em pontos. */
export interface ContentBox {
  left: number;
  right: number;
}

/** Símbolos que só servem para marcar item de lista, e nada mais. */
const STRONG_BULLETS = new Set(["•", "◦", "▪", "▫", "‣", "⁃", "●", "○", "■", "□", "◆", "◇"]);

/**
 * Símbolos que *podem* ser marcador, mas também aparecem como pontuação.
 *
 * Um travessão abre item de lista e também abre fala ou aposto; um asterisco
 * marca item e também nota de rodapé. Aceitar qualquer um deles isoladamente
 * transformava a linha "— documento gerado para teste —" numa lista de um item
 * só, com o travessão sumindo do texto. Por isso estes só valem quando há um
 * vizinho igual, no mesmo recuo.
 */
const WEAK_BULLETS = new Set([
  "·", "»", "–", "—", "-", "*",
  // Marcadores que o Word grava em Symbol e Wingdings e que chegam assim.
  "§", "¨", "Ø", "ü", "Ł",
]);

const NUMBER_MARKER = /^(\d+(?:\.\d+)*|[a-zA-Z]|[ivxlcdmIVXLCDM]+)([.)\]])$/;

const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Separa o marcador de lista do resto da linha.
 *
 * Devolve `null` quando a linha não é item de lista. O critério é conservador
 * de propósito: um número seguido de ponto no começo do parágrafo, sem recuo
 * pendente, quase sempre é um título numerado que a pessoa digitou à mão
 * ("1. Participantes"), e transformá-lo em lista automática do Word muda o
 * texto — o Word passaria a numerar sozinho e a renumerar ao editar.
 */
export function detectListMarker(
  line: TextLine,
): { marker: string; kind: "bullet" | "number"; textStart: number; strong: boolean } | null {
  const first = line.runs.find((r) => r.text.trim().length > 0);
  if (!first) return null;

  const token = first.text.trim().split(/\s+/)[0] ?? "";
  if (!token) return null;

  const strongBullet = token.length === 1 && STRONG_BULLETS.has(token);
  const weakBullet = token.length === 1 && WEAK_BULLETS.has(token);
  const isBullet = strongBullet || weakBullet;
  const numberMatch = NUMBER_MARKER.exec(token);
  if (!isBullet && !numberMatch) return null;

  // Onde o texto de fato começa depois do marcador.
  let textStart = Number.NaN;
  let passedMarker = false;
  for (const run of line.runs) {
    if (!passedMarker) {
      if (run === first) passedMarker = true;
      if (run.text.trim() === token || run === first) continue;
    }
    if (run.text.trim().length > 0) {
      textStart = run.x;
      break;
    }
  }
  if (!Number.isFinite(textStart)) {
    // Marcador e texto no mesmo trecho: não há recuo pendente medível.
    const rest = first.text.trim().slice(token.length).trim();
    if (!rest) return null;
    // Marcador de bala colado ao texto ainda é bala; número colado é título.
    return isBullet
      ? { marker: token, kind: "bullet", textStart: first.x, strong: strongBullet }
      : null;
  }

  if (isBullet) return { marker: token, kind: "bullet", textStart, strong: strongBullet };

  // Número só vira lista com recuo pendente de verdade.
  const em = line.fontSize || 12;
  const gap = textStart - (first.x + first.width);
  return gap > em * 0.35 ? { marker: token, kind: "number", textStart, strong: false } : null;
}

/**
 * Descarta listas que não se sustentam.
 *
 * Marcadores ambíguos (travessão, asterisco) e listas numeradas só valem quando
 * há outro item igual por perto; um item solto quase sempre é pontuação ou um
 * título numerado digitado à mão. Parágrafo centralizado ou alinhado à direita
 * nunca é item de lista — nenhum editor produz isso.
 */
function dropUnsupportedLists(paragraphs: Paragraph[]): void {
  const sameSeries = (a: Paragraph, b: Paragraph) =>
    a.list !== null && b.list !== null &&
    a.list.kind === b.list.kind &&
    Math.abs(a.list.markerIndent - b.list.markerIndent) < 4;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    if (!p.list) continue;

    if (p.alignment === "center" || p.alignment === "right") {
      p.list = null;
      continue;
    }

    const strongBullet = p.list.kind === "bullet" && STRONG_BULLETS.has(p.list.marker);
    if (strongBullet) continue;

    const hasSibling =
      (i > 0 && sameSeries(p, paragraphs[i - 1])) ||
      (i + 1 < paragraphs.length && sameSeries(p, paragraphs[i + 1]));
    if (!hasSibling) p.list = null;
  }
}

/** Alinhamento e recuos de um conjunto de linhas dentro da caixa de conteúdo. */
function measureLayout(lines: TextLine[], box: ContentBox, listTextStart: number | null) {
  const width = box.right - box.left;
  const bodyLines = lines.length > 1 ? lines.slice(1) : lines;

  // Num item de lista o recuo é o do texto, e não o do marcador.
  const lefts = lines.map((l, i) => (i === 0 && listTextStart !== null ? listTextStart : l.left));
  const bodyLefts = bodyLines.map((l, i) =>
    lines.length > 1 ? l.left : i === 0 && listTextStart !== null ? listTextStart : l.left,
  );

  const indentLeft = Math.min(...bodyLefts) - box.left;
  const rights = lines.map((l) => l.right);
  const indentRight = box.right - Math.max(...rights);
  const indentFirstLine = lines.length > 1 ? lefts[0] - Math.min(...bodyLefts) : 0;

  let alignment: Alignment = "left";
  const tolerance = Math.max(2, width * 0.012);

  const leftGaps = lines.map((l, i) => (i === 0 && listTextStart !== null ? listTextStart : l.left) - box.left);
  const rightGaps = lines.map((l) => box.right - l.right);

  const allCentered = lines.every((_, i) => Math.abs(leftGaps[i] - rightGaps[i]) <= tolerance)
    && Math.min(...leftGaps) > tolerance;
  const allRight = rightGaps.every((g) => Math.abs(g - rightGaps[0]) <= tolerance)
    && Math.max(...rightGaps) < width * 0.06
    && Math.min(...leftGaps) > tolerance;

  if (allCentered) {
    alignment = "center";
  } else if (allRight) {
    alignment = "right";
  } else if (lines.length > 1) {
    // Justificado: todas menos a última terminam praticamente no mesmo x, e
    // esse x é a borda direita do texto. Numa coluna alinhada à esquerda as
    // pontas variam com o tamanho da última palavra e isso não acontece.
    const heads = lines.slice(0, -1).map((l) => l.right);
    const spread = Math.max(...heads) - Math.min(...heads);
    if (spread <= tolerance && box.right - Math.max(...heads) <= width * 0.04) alignment = "justify";
  }

  return {
    alignment,
    indentLeft: Math.max(0, indentLeft),
    indentRight: Math.max(0, indentRight),
    indentFirstLine,
  };
}

/** Distância típica entre linhas de base, para calibrar o que é "espaço extra". */
export function measureLeading(lines: TextLine[]): number {
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].baseline - lines[i - 1].baseline;
    if (d > 0.5 && d < 200) deltas.push(d);
  }
  const value = median(deltas);
  return value > 0 ? value : (lines[0]?.fontSize ?? 12) * 1.2;
}

/**
 * Decide se a linha `next` começa um parágrafo novo, olhando só a geometria.
 * Usado quando o PDF não traz árvore de estrutura.
 */
function startsNewParagraph(
  previous: TextLine,
  next: TextLine,
  box: ContentBox,
  leading: number,
): boolean {
  const width = box.right - box.left;
  const delta = next.baseline - previous.baseline;

  // Espaço vertical extra é o sinal mais confiável.
  if (delta > leading * 1.28) return true;

  // Mudança de corpo ou de peso separa título de corpo de texto.
  if (Math.abs(next.fontSize - previous.fontSize) > 0.6) return true;

  // Recuo de primeira linha.
  if (next.left > previous.left + width * 0.04 && previous.right > box.right - width * 0.12) return true;

  // Linha anterior terminando muito cedo, com a seguinte voltando à margem:
  // é fim de parágrafo. O limite é alto porque, em texto alinhado à esquerda,
  // toda linha termina um pouco antes da margem.
  if (previous.right < box.right - width * 0.32 && next.left <= previous.left + width * 0.02) return true;

  return false;
}

/**
 * Monta os parágrafos de uma página.
 *
 * `structBlocks` vazio significa PDF sem árvore de estrutura, e aí vale a
 * geometria.
 */
export function buildParagraphs(
  lines: TextLine[],
  box: ContentBox,
  structBlocks: StructBlock[],
  /** Topo da caixa de conteúdo, para medir o espaço antes do primeiro bloco. */
  contentTop?: number,
): Paragraph[] {
  const ordered = lines.map(trimLine).filter((l) => l.text.trim().length > 0);
  if (!ordered.length) return [];

  const leading = measureLeading(ordered);
  const groups: TextLine[][] = [];

  const byOrder = new Map(structBlocks.map((b) => [b.order, b]));
  const structured = structBlocks.length > 0 && ordered.some((l) => l.structBlock !== null);

  for (const line of ordered) {
    const previousGroup = groups[groups.length - 1];
    const previous = previousGroup?.[previousGroup.length - 1];

    if (!previous) {
      groups.push([line]);
      continue;
    }

    let split: boolean;
    if (structured && line.structBlock !== null && previous.structBlock !== null) {
      const a = byOrder.get(previous.structBlock);
      const b = byOrder.get(line.structBlock);
      // O rótulo da lista (`Lbl`) e o corpo (`LBody`) são blocos diferentes na
      // árvore, mas uma linha só no documento.
      const sameListItem =
        a && b && a.listItem !== null && a.listItem === b.listItem && Math.abs(line.baseline - previous.baseline) < 1.5;
      split = line.structBlock !== previous.structBlock && !sameListItem;
    } else {
      split = startsNewParagraph(previous, line, box, leading);
    }

    if (split) groups.push([line]);
    else previousGroup.push(line);
  }

  const paragraphs: Paragraph[] = groups.map((group) => {
    const struct = group[0].structBlock !== null ? byOrder.get(group[0].structBlock) : undefined;

    let list: ListInfo | null = null;
    let listTextStart: number | null = null;
    const markerFont = group[0].runs.find((r) => r.text.trim())?.style.family ?? "Symbol";

    if (struct?.listItem !== null && struct?.listItem !== undefined) {
      const detected = detectListMarker(group[0]);
      list = {
        kind: detected?.kind ?? "bullet",
        level: Math.max(0, struct.listDepth - 1),
        marker: detected?.marker ?? "•",
        markerIndent: Math.max(0, group[0].left - box.left),
        markerFont,
        structItem: struct.listItem,
      };
      listTextStart = detected?.textStart ?? null;
    } else if (!structured) {
      const detected = detectListMarker(group[0]);
      if (detected) {
        list = {
          kind: detected.kind,
          level: 0,
          marker: detected.marker,
          markerIndent: Math.max(0, group[0].left - box.left),
          markerFont,
          structItem: null,
        };
        listTextStart = detected.textStart;
      }
    }

    const layout = measureLayout(group, box, listTextStart);
    const own = measureLeading(group);
    const outlineLevel = struct && /^H([1-6])$/.test(struct.role) ? Number(struct.role[1]) : 0;

    return {
      lines: group,
      ...layout,
      lineSpacing: group.length > 1 ? own : 0,
      spaceAfter: 0,
      spaceBefore: 0,
      list,
      outlineLevel,
      top: Math.min(...group.map((l) => l.top)),
      bottom: Math.max(...group.map((l) => l.bottom)),
      table: struct?.table ?? null,
      tableRow: struct?.tableRow ?? null,
      tableCell: struct?.tableCell ?? null,
      headerCell: struct?.role === "TH",
      endsFull: group[group.length - 1].right >= box.right - (box.right - box.left) * 0.06,
    };
  });

  // A árvore de estrutura já disse o que é lista; sem ela, o palpite precisa
  // ser conferido contra os vizinhos antes de valer.
  if (!structured) dropUnsupportedLists(paragraphs);

  // Proporção entre entrelinha e corpo de letra observada neste documento,
  // medida só onde ela é conhecida de fato — dentro de parágrafos de mais de
  // uma linha. Serve para estimar a altura de linha de um parágrafo de uma
  // linha só, que não tem entrelinha própria para medir.
  const ratios = paragraphs
    .filter((p) => p.lineSpacing > 0 && p.lines[0].fontSize > 0)
    .map((p) => p.lineSpacing / p.lines[0].fontSize);
  const lineRatio = ratios.length ? median(ratios) : 1.2;

  // O espaço entre parágrafos vira "espaço depois" do que vem antes. Guardar
  // sempre do mesmo lado evita somar o "antes" de um com o "depois" do outro
  // e abrir o dobro do buraco no Word.
  //
  // O desconto é a altura da linha do parágrafo **seguinte**, e não uma média
  // da página: o vão entre duas linhas de base é o espaço configurado mais a
  // altura da linha que chega. Descontar uma média fazia o espaço antes de um
  // título de corpo maior sumir por completo.
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const here = paragraphs[i];
    const next = paragraphs[i + 1];
    const lastBaseline = here.lines[here.lines.length - 1].baseline;
    const nextBaseline = next.lines[0].baseline;
    const step = next.lineSpacing || next.lines[0].fontSize * lineRatio || leading;
    const extra = nextBaseline - lastBaseline - step;
    here.spaceAfter = Math.max(0, Math.round(extra * 10) / 10);
  }

  // O primeiro parágrafo da página não tem um anterior de quem herdar o vão.
  // Sem isto, o espaço que o Word reservava antes do título da página some e
  // todo o conteúdo sobe, colado na margem superior.
  if (paragraphs.length && contentTop !== undefined) {
    const first = paragraphs[0];
    first.spaceBefore = Math.max(0, Math.round((first.top - contentTop) * 10) / 10);
  }

  return paragraphs;
}

/**
 * Remove do marcador o texto do rótulo, que no DOCX passa a ser gerado pela
 * numeração automática do Word.
 */
export function stripListMarker(paragraph: Paragraph): Paragraph {
  if (!paragraph.list) return paragraph;
  const marker = paragraph.list.marker;
  const first = { ...paragraph.lines[0] };
  const runs = first.runs.map((r) => ({ ...r }));

  let removed = false;
  while (runs.length && !removed) {
    const text = runs[0].text;
    const trimmed = text.trimStart();
    if (!trimmed) {
      runs.shift();
      continue;
    }
    if (trimmed.startsWith(marker)) {
      // O `\s` do JavaScript já cobre o espaço inquebrável (U+00A0), que é o
      // que o Word costuma pôr entre a bala e o texto.
      const rest = trimmed.slice(marker.length).replace(/^\s+/, "");
      if (rest) runs[0] = { ...runs[0], text: rest };
      else runs.shift();
      removed = true;
    } else {
      break;
    }
  }
  // Sobra de espaço/tabulação que o Word usava para empurrar o texto.
  while (runs.length && !runs[0].text.trim()) runs.shift();

  first.runs = runs;
  first.text = runs.map((r) => r.text).join("");
  const lines = [first, ...paragraph.lines.slice(1)];
  return { ...paragraph, lines };
}
