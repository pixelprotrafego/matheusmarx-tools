/**
 * Paginação de fallback para DOCX -> PDF.
 *
 * O `docx-preview` não reflui texto: ele só começa uma <section> nova quando o
 * documento traz uma marca explícita de quebra. Quando o arquivo foi salvo pelo
 * Word, essas marcas existem (`w:lastRenderedPageBreak`) e a paginação sai fiel
 * ao original. Quando o arquivo veio do Google Docs, do LibreOffice ou de um
 * gerador automático, elas não existem e a seção cresce indefinidamente — era
 * daí que saía o PDF de página única.
 *
 * Este módulo decide onde cortar uma seção alta demais, preferindo sempre a
 * borda de um bloco (parágrafo, tabela, imagem) para não partir uma linha de
 * texto no meio.
 */

/** Retângulo de um bloco, em pixels, relativo ao topo da seção. */
export interface Block {
  top: number;
  bottom: number;
}

/** Uma página do PDF: recorte vertical da seção renderizada. */
export interface Slice {
  top: number;
  height: number;
}

/**
 * Tolerância para altura: uma seção só é considerada "maior que uma página"
 * se passar disso. Evita fatiar por causa de arredondamento de subpixel.
 */
const OVERFLOW_TOLERANCE_PX = 4;

/**
 * Divide uma seção de `contentHeight` px em fatias de no máximo `pageHeight` px.
 *
 * Os cortes caem em bordas de blocos sempre que possível. Um bloco isolado mais
 * alto que uma página inteira (uma imagem gigante, uma tabela longa) é cortado
 * na altura cheia, porque não há borda melhor disponível.
 */
export function planSlices(blocks: Block[], contentHeight: number, pageHeight: number): Slice[] {
  if (!(pageHeight > 0) || !(contentHeight > 0)) return [{ top: 0, height: Math.max(contentHeight, 0) }];

  // Cabe em uma página: nada a fatiar.
  if (contentHeight <= pageHeight + OVERFLOW_TOLERANCE_PX) {
    return [{ top: 0, height: contentHeight }];
  }

  // Só interessam blocos dentro da seção e em ordem de topo.
  const ordered = blocks
    .filter((b) => Number.isFinite(b.top) && Number.isFinite(b.bottom) && b.bottom > b.top)
    .sort((a, b) => a.top - b.top);

  const slices: Slice[] = [];
  let start = 0;
  let guard = 0;

  while (start < contentHeight - OVERFLOW_TOLERANCE_PX) {
    // Trava de segurança: nunca mais fatias do que páginas cheias possíveis.
    if (++guard > Math.ceil(contentHeight / pageHeight) + 2) break;

    const limit = start + pageHeight;

    // Último bloco que termina dentro do limite: o corte vai logo depois dele.
    let cut = 0;
    for (const b of ordered) {
      if (b.top < start) continue;
      if (b.bottom <= limit) cut = Math.max(cut, b.bottom);
      else break;
    }

    // Nenhuma borda utilizável (bloco mais alto que a página, ou seção sem
    // blocos mapeados): corta na altura cheia da página.
    if (cut <= start) cut = limit;

    const end = Math.min(cut, contentHeight);
    slices.push({ top: start, height: end - start });
    start = end;
  }

  // Sobra final (o resto que não fechou uma página inteira).
  if (start < contentHeight - OVERFLOW_TOLERANCE_PX) {
    slices.push({ top: start, height: contentHeight - start });
  }

  return slices;
}
