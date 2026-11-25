/**
 * Paginação: em que página e coluna vai cada trecho do documento.
 *
 * O fluxo de cada seção foi montado como uma coluna contínua; aqui ele é
 * fatiado na altura útil de cada página — descontados cabeçalho, rodapé e as
 * notas de rodapé daquela página —, sempre num corte que o Word aceitaria.
 */

import type { Cut, FlowMetrics } from "./measure";
import type { Margins, SectionProps } from "./model";

export interface FlowPiece {
  flow: number;
  /** Faixa do fluxo, em pontos. */
  y0: number;
  y1: number;
  /** Onde ela vai na página, em pontos a partir do canto superior esquerdo. */
  x: number;
  y: number;
}

export type RunningKind = "first" | "even" | "default";

export interface PlannedPage {
  section: number;
  width: number;
  height: number;
  margins: Margins;
  pieces: FlowPiece[];
  footnotes: string[];
  number: number;
  /** Formato do número da página (o da seção: decimal, lowerRoman...). */
  numberFormat: string;
  /** Página dentro da seção, para SECTIONPAGES. */
  sectionPage: number;
  running: RunningKind;
  bodyTop: number;
  bodyBottom: number;
  /** Largura da coluna de texto (para as notas de rodapé). */
  columnWidth: number;
  columnLeft: number;
}

export interface SectionLayout {
  index: number;
  props: SectionProps;
  flow: FlowMetrics;
  flowIndex: number;
  columnWidth: number;
  columnLefts: number[];
  headerHeight: (kind: RunningKind) => number;
  footerHeight: (kind: RunningKind) => number;
}

export function paginate(
  sections: SectionLayout[],
  notesHeight: (ids: string[]) => number,
  evenAndOdd: boolean,
  /** Tirar o espaço antes do parágrafo também depois de quebra manual. */
  suppressAfterHardBreak: boolean,
): PlannedPage[] {
  const pages: PlannedPage[] = [];
  const lastPage = (): PlannedPage | null => pages[pages.length - 1] ?? null;
  let pageNumber = 0;

  const newPage = (sec: SectionLayout, first: boolean): PlannedPage => {
    const p = sec.props;
    pageNumber = first && p.pageNumberStart !== null ? p.pageNumberStart : pageNumber + 1;
    const previous = lastPage();
    const sectionPage = !first && previous && previous.section === sec.index ? previous.sectionPage + 1 : 1;
    const running: RunningKind = first && p.titlePage ? "first" : evenAndOdd && pageNumber % 2 === 0 ? "even" : "default";
    const m = p.margins;
    // Cabeçalho mais alto que a margem empurra o corpo para baixo; com o rodapé
    // é o mesmo, para cima.
    const bodyTop = Math.max(m.top, m.header + sec.headerHeight(running));
    const bodyBottom = p.pageHeight - Math.max(m.bottom, m.footer + sec.footerHeight(running));
    const created: PlannedPage = {
      section: sec.index,
      width: p.pageWidth,
      height: p.pageHeight,
      margins: m,
      pieces: [],
      footnotes: [],
      number: pageNumber,
      numberFormat: p.pageNumberFormat ?? "decimal",
      sectionPage,
      running,
      bodyTop,
      bodyBottom,
      columnWidth: sec.columnWidth,
      columnLeft: sec.columnLefts[0],
    };
    pages.push(created);
    return created;
  };

  for (const sec of sections) {
    const p = sec.props;
    const flow = sec.flow;
    const page = lastPage();
    const sameSize = page !== null && Math.abs(page.width - p.pageWidth) < 1 && Math.abs(page.height - p.pageHeight) < 1;
    let current: PlannedPage;
    let regionTop: number;
    if (page === null || p.type !== "continuous" || !sameSize) {
      current = newPage(sec, true);
      if ((p.type === "evenPage" && current.number % 2 === 1) || (p.type === "oddPage" && current.number % 2 === 0)) {
        current = newPage(sec, false);
      }
      regionTop = current.bodyTop;
    } else {
      current = page;
      const lastPieces = current.pieces;
      regionTop = lastPieces.length ? Math.max(...lastPieces.map((x) => x.y + (x.y1 - x.y0))) : current.bodyTop;
    }

    const columns = Math.max(1, p.columns.count);
    let column = 0;
    let regionBottom = regionTop;
    let y0 = 0;
    let guard = 0;

    while (y0 < flow.height - 0.5 && guard++ < 100000) {
      // Cabeçalho de tabela repetido no alto da página ou coluna seguinte.
      let top = regionTop;
      const table = flow.tables.find((t) => t.header && y0 > t.header.bottom + 0.5 && y0 < t.bottom - 0.5);
      const pieceHeader = table?.header && table.header.bottom < table.bottom - 1 && (top === current.bodyTop || column > 0)
        ? table.header
        : null;
      if (pieceHeader) top += pieceHeader.bottom - pieceHeader.top;

      const notesOnPage = current.footnotes;
      const avail = (extra: string[]) => current.bodyBottom - top - notesHeight([...notesOnPage, ...extra]);
      const fresh = current.pieces.length === 0 && column === 0 && top <= current.bodyTop + 0.5 + (pieceHeader ? pieceHeader.bottom - pieceHeader.top : 0);
      const cut = chooseCut(flow, y0, avail, fresh);

      if (!cut) {
        if (column + 1 < columns) column++;
        else {
          current = newPage(sec, false);
          regionTop = current.bodyTop;
          regionBottom = regionTop;
          column = 0;
        }
        continue;
      }

      const x = sec.columnLefts[Math.min(column, sec.columnLefts.length - 1)];
      if (pieceHeader) current.pieces.push({ flow: sec.flowIndex, y0: pieceHeader.top, y1: pieceHeader.bottom, x, y: regionTop });
      current.pieces.push({ flow: sec.flowIndex, y0, y1: cut.y, x, y: top });
      for (const ref of flow.footnotes) if (ref.y > y0 && ref.y <= cut.y + 0.5 && !current.footnotes.includes(ref.id)) current.footnotes.push(ref.id);
      regionBottom = Math.max(regionBottom, top + (cut.y - y0));
      y0 = cut.y;
      if (y0 >= flow.height - 0.5) break;
      // Espaço antes do parágrafo some no alto da página, numa quebra natural
      // (e, nos documentos do Word 2013 ou mais novo, também na manual).
      // Um bloco sem altura (a marca de quebra) divide o ponto com o seguinte:
      // vale o espaço antes de qualquer bloco que comece ali.
      if (!cut.forced || (cut.forced === "page" && suppressAfterHardBreak)) {
        const skip = Math.max(cut.skip, ...flow.cuts.filter((c) => Math.abs(c.y - cut.y) < 0.5).map((c) => c.skip));
        y0 = Math.min(flow.height, y0 + skip);
      }

      if (cut.forced === "page" || (cut.forced === "column" && column + 1 >= columns)) {
        current = newPage(sec, false);
        regionTop = current.bodyTop;
        regionBottom = regionTop;
        column = 0;
      } else if (column + 1 < columns) {
        column++;
      } else {
        current = newPage(sec, false);
        regionTop = current.bodyTop;
        regionBottom = regionTop;
        column = 0;
      }
    }
    void regionBottom;
  }

  return pages;
}

/**
 * O corte mais baixo que cabe. Quebra obrigatória vem antes de tudo; depois,
 * os cortes que o Word aceita; por último, os de emergência. Num lugar que já
 * tem conteúdo, nada cabendo, devolve `null` e o conteúdo vai para a próxima
 * página; numa página vazia, corta onde der, para não travar.
 */
function chooseCut(flow: FlowMetrics, y0: number, avail: (notes: string[]) => number, fresh: boolean): Cut | null {
  const refsUpTo = (y: number) => flow.footnotes.filter((f) => f.y > y0 && f.y <= y + 0.5).map((f) => f.id);
  const fits = (c: Cut) => c.y - c.slack - y0 <= avail(refsUpTo(c.y)) + 0.5;
  const candidates = flow.cuts.filter((c) => c.y > y0 + 0.5);

  const forced = candidates.find((c) => c.forced);
  if (forced && fits(forced)) return forced;
  const reachable = forced ? candidates.filter((c) => c.y <= forced.y + 0.5) : candidates;

  for (const pass of ["allowed", "fallback"] as const) {
    for (let i = reachable.length - 1; i >= 0; i--) {
      const c = reachable[i];
      if (!c[pass]) continue;
      if (fits(c)) return c;
    }
    if (!fresh) return null;
  }
  // Página vazia e nada cabe (imagem maior que a página): corta na altura útil.
  const limit = y0 + Math.max(10, avail([]));
  return { y: Math.min(flow.height, limit), allowed: true, fallback: true, forced: null, skip: 0, slack: 0 };
}
