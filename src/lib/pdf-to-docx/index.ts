/**
 * Conversão de PDF para Word.
 *
 * A ordem das etapas importa e cada uma depende da anterior:
 *
 * 1. `extract` lê a página e devolve texto com fonte e cor, imagens e traços;
 * 2. `lines` junta os pedaços soltos em linhas;
 * 3. `sections` separa cabeçalho e rodapé do corpo e mede as margens — precisa
 *    de todas as páginas juntas, porque a prova de cabeçalho é a repetição;
 * 4. `blocks` agrupa as linhas do corpo em parágrafos;
 * 5. `tables` remonta as tabelas e o sublinhado;
 * 6. `build` traduz tudo para OOXML.
 *
 * O que este arquivo faz por conta própria é o que só se decide com o documento
 * inteiro na mão: a ordem entre parágrafos, tabelas e imagens dentro da página,
 * e a junção de um parágrafo que atravessa a quebra de página.
 */

import type { BodyItem, DocumentPlan } from "./build";
import { buildDocx } from "./build";
import { buildParagraphs, stripListMarker, type Paragraph } from "./blocks";
import { extractPage } from "./extract";
import { groupIntoLines, type TextLine } from "./lines";
import { classifyBands, planSection, type PageBands } from "./sections";
import {
  applyRuleDecorations,
  buildRuledTable,
  buildStructTables,
  detectRuledGrids,
  type DocTable,
} from "./tables";
import type { PageContent, PlacedImage } from "./types";

export interface ConvertOptions {
  /** Progresso de 0 a 100. */
  onProgress?: (percent: number, status: string) => void;
}

export interface ConvertResult {
  blob: Blob;
  pages: number;
  /** Páginas sem nenhum texto extraível — PDF de imagem ou digitalizado. */
  pagesWithoutText: number;
}

/** Erro com mensagem pronta para mostrar a quem está usando a ferramenta. */
export class PdfWithoutTextError extends Error {
  constructor(pages: number) {
    super(
      pages === 1
        ? "Este PDF não tem texto: a página é uma imagem digitalizada ou foi gerada como foto do documento. Não há o que extrair para o Word."
        : `Este PDF não tem texto em nenhuma das ${pages} páginas: elas são imagens digitalizadas ou fotos do documento. Não há o que extrair para o Word.`,
    );
    this.name = "PdfWithoutTextError";
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Marca links e decorações desenhadas nos trechos de texto de uma página. */
function decorateLines(lines: TextLine[], content: PageContent) {
  applyRuleDecorations(lines, content.rules);

  if (!content.links.length) return;
  for (const line of lines) {
    for (const link of content.links) {
      if (line.baseline < link.y - 2 || line.baseline > link.y + link.height + 2) continue;
      for (const run of line.runs) {
        const overlap = Math.min(run.x + run.width, link.x + link.width) - Math.max(run.x, link.x);
        if (overlap > Math.min(run.width, link.width) * 0.5) run.link = link.url;
      }
    }
  }
}

/**
 * Decide se o primeiro parágrafo de uma página é a continuação do último
 * parágrafo da página anterior.
 *
 * Um parágrafo cortado pela quebra de página aparece como dois no PDF, um em
 * cada página. Emendá-los é o que evita que o texto do Word fique picotado em
 * frases pela metade — e, junto, é o que diz que ali não cabe uma quebra de
 * página manual, porque o Word vai quebrar sozinho no meio do parágrafo.
 */
function continuesAcrossPages(previous: Paragraph | undefined, next: Paragraph | undefined): boolean {
  if (!previous || !next) return false;
  if (previous.list || next.list) return false;
  if (previous.table !== null || next.table !== null) return false;
  if (next.outlineLevel > 0) return false;
  // A anterior tem de terminar cheia: parágrafo que acabou antes da margem
  // acabou de verdade.
  if (!previous.endsFull) return false;
  // A seguinte tem de começar rente à margem, sem recuo de primeira linha.
  if (next.indentFirstLine > 1) return false;
  if (Math.abs(next.indentLeft - previous.indentLeft) > 2) return false;
  // E tem de começar em minúscula ou continuar uma frase, não abrir outra.
  const start = next.lines[0]?.text.trim() ?? "";
  return start.length > 0 && !/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9•\-–—]/.test(start[0]);
}

/** Ordena parágrafos, tabelas e imagens de uma página pela posição vertical. */
function orderPage(
  paragraphs: Paragraph[],
  tables: Map<number, DocTable>,
  images: PlacedImage[],
  contentBox: { left: number; right: number },
): BodyItem[] {
  type Entry = { top: number; bottom: number; item: BodyItem };
  const entries: Entry[] = [];

  for (const paragraph of paragraphs) {
    entries.push({ top: paragraph.top, bottom: paragraph.bottom, item: { kind: "paragraph", paragraph } });
  }
  for (const table of tables.values()) {
    entries.push({ top: table.top, bottom: table.bottom, item: { kind: "table", table } });
  }
  for (const image of images) {
    const width = contentBox.right - contentBox.left;
    const leftGap = image.x - contentBox.left;
    const rightGap = contentBox.right - (image.x + image.width);
    const alignment: "left" | "center" | "right" =
      Math.abs(leftGap - rightGap) <= Math.max(4, width * 0.03) ? "center"
      : rightGap < leftGap ? "right"
      : "left";
    entries.push({
      top: image.y,
      bottom: image.y + image.height,
      item: { kind: "image", image, alignment, spaceAfter: 0 },
    });
  }

  entries.sort((a, b) => a.top - b.top);

  // O espaçamento dos parágrafos foi medido antes de as tabelas e imagens
  // entrarem no meio, e por isso mede o vão até o parágrafo seguinte, que ficou
  // do outro lado da tabela. Deixar assim abriria o buraco duas vezes: uma no
  // "espaço depois" do parágrafo e outra na altura da própria tabela.
  for (let i = 0; i < entries.length; i++) {
    const here = entries[i];
    const next = entries[i + 1];
    if (here.item.kind === "paragraph" && next && next.item.kind !== "paragraph") {
      here.item.paragraph.spaceAfter = Math.max(0, Math.round((next.top - here.bottom) * 10) / 10);
    }
    if (here.item.kind !== "paragraph" && next?.item.kind === "paragraph") {
      next.item.paragraph.spaceBefore = Math.max(0, Math.round((next.top - here.bottom) * 10) / 10);
    }
  }

  return entries.map((e) => e.item);
}

/** Converte um PDF inteiro em um arquivo .docx. */
export async function pdfToDocx(
  data: ArrayBuffer,
  options: ConvertOptions = {},
): Promise<ConvertResult> {
  const report = (percent: number, status: string) => options.onProgress?.(clamp(percent, 0, 100), status);

  report(4, "Abrindo o PDF...");
  const { pdfjsLib } = await import("@/lib/pdfjs-setup");
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageCount = pdf.numPages;

  // ---- 1 e 2: extração e linhas, página a página ----
  const pages: { content: PageContent; lines: TextLine[] }[] = [];
  for (let i = 1; i <= pageCount; i++) {
    report(4 + (i / pageCount) * 46, `Lendo a página ${i} de ${pageCount}...`);
    const page = await pdf.getPage(i);
    const content = await extractPage(
      pdfjsLib as unknown as Parameters<typeof extractPage>[0],
      page as unknown as Parameters<typeof extractPage>[1],
      i - 1,
    );
    const lines = groupIntoLines(content.runs);
    decorateLines(lines, content);
    pages.push({ content, lines });
  }

  const pagesWithoutText = pages.filter((p) => !p.lines.length).length;
  if (pagesWithoutText === pageCount) throw new PdfWithoutTextError(pageCount);

  // ---- 3: cabeçalho, rodapé e margens ----
  report(54, "Separando cabeçalho e rodapé...");
  const bands: PageBands[] = classifyBands(pages);
  const withBands = pages.map((page, index) => ({ content: page.content, bands: bands[index] }));
  const section = planSection(withBands);

  const contentBox = {
    left: section.margins.left,
    right: section.pageWidth - section.margins.right,
  };

  // Imagens já usadas no cabeçalho ou no rodapé não podem voltar no corpo.
  const usedImages = new Set<PlacedImage>();
  for (const running of [section.firstPageHeader, section.firstPageFooter, section.defaultHeader, section.defaultFooter]) {
    for (const image of running?.images ?? []) usedImages.add(image);
  }
  // O fundo de página e a faixa do cabeçalho se repetem em toda página, com
  // outra instância de imagem em cada uma; comparar só por referência deixaria
  // as cópias das outras páginas entrarem no corpo.
  const runningFootprints = new Set(
    [...usedImages].map((i) => `${Math.round(i.x)},${Math.round(i.y)},${Math.round(i.width)}x${Math.round(i.height)}`),
  );

  // ---- 4 e 5: parágrafos, tabelas e ordenação ----
  const body: BodyItem[] = [];

  for (let index = 0; index < pages.length; index++) {
    report(56 + (index / pages.length) * 34, `Montando a página ${index + 1} de ${pageCount}...`);
    const page = pages[index];
    const tagged = page.content.structBlocks.length > 0;

    // Sem árvore de estrutura, as tabelas são reconhecidas pelos traços e as
    // linhas que caem dentro delas saem do fluxo de texto antes de virarem
    // parágrafos — senão o conteúdo das células vira uma frase corrida.
    const paragraphsOf = (source: TextLine[], box: { left: number; right: number }, top?: number) =>
      buildParagraphs(source, box, page.content.structBlocks, top)
        .map((p) => (p.list ? stripListMarker(p) : p))
        .filter((p) => p.lines.some((l) => l.text.trim().length > 0));

    const ruledTables: DocTable[] = [];
    let bodyLines = bands[index].body;
    if (!tagged) {
      for (const grid of detectRuledGrids(page.content.rules)) {
        const { table, used } = buildRuledTable(
          grid,
          bodyLines,
          page.content.rules,
          page.content.fills,
          (cellLines, cellBox) => paragraphsOf(cellLines, cellBox),
        );
        if (!table.rows.some((r) => r.cells.some((c) => c.paragraphs.length))) continue;
        ruledTables.push(table);
        bodyLines = bodyLines.filter((l) => !used.has(l));
      }
    }

    const paragraphs = paragraphsOf(bodyLines, contentBox, section.margins.top);
    const { tables, loose } = buildStructTables(paragraphs, page.content.rules, page.content.fills);
    ruledTables.forEach((table, i) => tables.set(-1 - i, table));
    const images = page.content.images.filter(
      (i) =>
        !usedImages.has(i) &&
        !runningFootprints.has(`${Math.round(i.x)},${Math.round(i.y)},${Math.round(i.width)}x${Math.round(i.height)}`),
    );

    const ordered = orderPage(loose, tables, images, contentBox);

    // Só emenda com o que está de fato no fim do documento montado até aqui;
    // um parágrafo anterior seguido de uma tabela ou de uma imagem já não é
    // continuação de nada.
    const tail = body[body.length - 1];
    const openParagraph = tail?.kind === "paragraph" ? tail.paragraph : undefined;
    const first = ordered[0];
    const continues =
      index > 0 &&
      first?.kind === "paragraph" &&
      continuesAcrossPages(openParagraph, first.paragraph);

    if (index > 0 && !continues) body.push({ kind: "page-break" });

    for (const entry of ordered) {
      if (continues && entry === first && entry.kind === "paragraph" && openParagraph) {
        // Emenda: as linhas da página seguinte entram no parágrafo anterior.
        openParagraph.lines = [...openParagraph.lines, ...entry.paragraph.lines];
        openParagraph.spaceAfter = entry.paragraph.spaceAfter;
        openParagraph.endsFull = entry.paragraph.endsFull;
        continue;
      }
      body.push(entry);
    }
  }

  // ---- 6: geração do arquivo ----
  report(92, "Gerando o arquivo do Word...");
  const docx = await import("docx");
  const plan: DocumentPlan = {
    section,
    body,
    contentLeft: contentBox.left,
    contentRight: contentBox.right,
  };
  const blob = await buildDocx(docx, plan);

  report(100, "Concluído");
  return { blob, pages: pageCount, pagesWithoutText };
}
