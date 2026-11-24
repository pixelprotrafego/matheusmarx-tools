/**
 * Onde a página pode ser cortada.
 *
 * O documento é montado como uma coluna contínua; a paginação escolhe onde
 * cortá-la. Este módulo lista os cortes possíveis e diz quais o Word permite:
 *
 * - entre duas linhas de um parágrafo, exceto se isso deixar uma linha sozinha
 *   no pé ou no alto da página (controle de linhas viúvas e órfãs) ou se o
 *   parágrafo pede para não ser partido;
 * - entre dois blocos, exceto depois de um parágrafo que pede para ficar com o
 *   seguinte (título que não pode ficar sozinho no pé da página);
 * - entre linhas de uma tabela.
 *
 * Quebra de página e de coluna são cortes obrigatórios.
 */

import { PX } from "./render-dom";

export interface Cut {
  /** Posição do corte, em pontos, a partir do topo do fluxo. */
  y: number;
  /** O Word aceita cortar aqui. */
  allowed: boolean;
  /** Último recurso: corte dentro de uma linha de tabela mais alta que a página. */
  fallback: boolean;
  forced: "page" | "column" | null;
  /** Espaço antes do bloco seguinte, que some quando ele abre a página. */
  skip: number;
  /**
   * Espaço depois do bloco anterior. Ele não precisa caber: no pé da página o
   * Word deixa esse espaço passar da margem, em vez de levar o parágrafo para
   * a página seguinte.
   */
  slack: number;
}

export interface TableSpan {
  top: number;
  bottom: number;
  /** Linhas de cabeçalho que se repetem em cada página, quando há. */
  header: { top: number; bottom: number } | null;
}

export interface FlowMetrics {
  height: number;
  cuts: Cut[];
  footnotes: { y: number; id: string }[];
  tables: TableSpan[];
}

interface Line {
  top: number;
  bottom: number;
}

/** Linhas de um elemento, pelos retângulos do conteúdo dele. */
export function linesOf(element: HTMLElement, originTop: number): Line[] {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0.5);
  const lines: Line[] = [];
  for (const r of rects.sort((a, b) => a.top - b.top)) {
    const top = (r.top - originTop) * PX;
    const bottom = (r.bottom - originTop) * PX;
    const line = lines.find((l) => Math.min(l.bottom, bottom) - Math.max(l.top, top) > Math.min(l.bottom - l.top, bottom - top) * 0.5);
    if (line) {
      line.top = Math.min(line.top, top);
      line.bottom = Math.max(line.bottom, bottom);
    } else lines.push({ top, bottom });
  }
  // Fundir linhas que ainda se sobrepõem (um objeto flutuante alto abraça
  // várias linhas de texto, e o corte não pode passar no meio dele).
  lines.sort((a, b) => a.top - b.top);
  const merged: Line[] = [];
  for (const l of lines) {
    const last = merged[merged.length - 1];
    if (last && l.top < last.bottom - 0.5) last.bottom = Math.max(last.bottom, l.bottom);
    else merged.push({ ...l });
  }
  return merged;
}

export function measureFlow(root: HTMLElement): FlowMetrics {
  const rootRect = root.getBoundingClientRect();
  const originTop = rootRect.top;
  const rel = (v: number) => (v - originTop) * PX;
  const cuts: Cut[] = [];
  const tables: TableSpan[] = [];
  const blocks = Array.from(root.children) as HTMLElement[];

  blocks.forEach((block, index) => {
    const rect = block.getBoundingClientRect();
    const previous = blocks[index - 1];
    const before = Number(block.dataset.before ?? 0);
    cuts.push({
      y: rel(rect.top),
      allowed: index > 0 && previous?.dataset.keepNext !== "1",
      fallback: index > 0,
      forced: index > 0 && block.dataset.breakBefore === "1" ? "page" : null,
      skip: before,
      slack: Number(previous?.dataset.after ?? 0) + Number(previous?.dataset.extra ?? 0),
    });

    if (block.classList.contains("p")) {
      const inner = block.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const lines = linesOf(inner, originTop);
      const keepLines = block.dataset.keepLines === "1";
      const widow = block.dataset.widow === "1";
      const extra = Number(block.dataset.extra ?? 0);
      for (let i = 0; i + 1 < lines.length; i++) {
        const orphan = widow && i === 0;
        const widowCut = widow && i === lines.length - 2;
        cuts.push({
          y: (lines[i].bottom + lines[i + 1].top) / 2,
          allowed: !keepLines && !orphan && !widowCut,
          fallback: true,
          forced: null,
          skip: 0,
          slack: extra,
        });
      }
      // Quebra de coluna dentro do parágrafo.
      for (const mark of Array.from(inner.querySelectorAll<HTMLElement>("span.colbreak"))) {
        const y = rel(mark.getBoundingClientRect().bottom);
        cuts.push({ y: y + 0.5, allowed: true, fallback: true, forced: "column", skip: 0, slack: 0 });
      }
      return;
    }

    // Tabela: corte entre linhas; dentro da linha só como último recurso.
    const rows = Array.from(block.querySelectorAll<HTMLTableRowElement>(":scope > table > tbody > tr"));
    // Cabeçalho repetido: as linhas marcadas, seguidas, a partir da primeira.
    let headerBottom: number | null = null;
    let headerTop: number | null = null;
    let inHeader = true;
    rows.forEach((tr, r) => {
      const rr = tr.getBoundingClientRect();
      if (inHeader && tr.dataset.header === "1") {
        headerTop ??= rel(rr.top);
        headerBottom = rel(rr.bottom);
      } else inHeader = false;
      if (r > 0) {
        const previousHeader = rows[r - 1].dataset.header === "1";
        cuts.push({ y: rel(rr.top), allowed: !previousHeader, fallback: true, forced: null, skip: 0, slack: 0 });
      }
      if (tr.dataset.cantSplit === "1") return;
      // Linhas de texto das células: cortes de último recurso dentro da linha.
      const inner: Line[] = [];
      for (const pi of Array.from(tr.querySelectorAll<HTMLElement>("div.pi"))) inner.push(...linesOf(pi, originTop));
      inner.sort((a, b) => a.top - b.top);
      for (let i = 0; i + 1 < inner.length; i++) {
        const gapTop = Math.max(...inner.slice(0, i + 1).map((l) => l.bottom));
        const gapBottom = inner[i + 1].top;
        if (gapBottom > gapTop) cuts.push({ y: (gapTop + gapBottom) / 2, allowed: false, fallback: true, forced: null, skip: 0, slack: 0 });
      }
    });
    const tableRect = block.getBoundingClientRect();
    tables.push({
      top: rel(tableRect.top),
      bottom: rel(tableRect.bottom),
      header: headerTop !== null && headerBottom !== null ? { top: headerTop, bottom: headerBottom } : null,
    });
  });

  const height = rel(rootRect.bottom);
  const lastBlock = blocks[blocks.length - 1];
  cuts.push({
    y: height, allowed: true, fallback: true, forced: null, skip: 0,
    slack: Number(lastBlock?.dataset.after ?? 0) + Number(lastBlock?.dataset.extra ?? 0),
  });
  cuts.sort((a, b) => a.y - b.y);

  const footnotes = Array.from(root.querySelectorAll<HTMLElement>("span.fnref[data-fn]")).map((s) => ({
    y: rel(s.getBoundingClientRect().bottom),
    id: s.dataset.fn!,
  }));

  return { height, cuts, footnotes, tables };
}
