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

import type { BodyItem, DocumentPart, DocumentPlan } from "./build";
import { buildDocx } from "./build";
import { buildParagraphs, stripListMarker, type Paragraph } from "./blocks";
import { extractPage } from "./extract";
import { extractFootnotes, type Footnote } from "./footnotes";
import { findGutters, partitionPage, type Gutter, type PageSegment } from "./layout";
import { groupIntoLines, type TextLine } from "./lines";
import { classifyBands, estimateRightEdge, groupPagesBySize, planSection, type PageBands } from "./sections";
import {
  applyRuleDecorations,
  buildRuledTable,
  buildStructTables,
  detectRuledGrids,
  type DocTable,
  type RuledGrid,
  type TableCell,
} from "./tables";
import type { FilledArea, PageContent, PlacedImage, Rgb, TextRun } from "./types";
import { openPdfjs } from "@/lib/pdf-unlock";

export interface ConvertOptions {
  /** Progresso de 0 a 100. */
  onProgress?: (percent: number, status: string) => void;
  /** Senha de abertura, quando o PDF tem uma. */
  password?: string;
}

export interface ConvertResult {
  blob: Blob;
  pages: number;
  /** Páginas sem nenhum texto extraível — PDF de imagem ou digitalizado. */
  pagesWithoutText: number;
}

/**
 * Erro com mensagem pronta para mostrar a quem está usando a ferramenta: o PDF
 * não tem nada — nem texto, nem imagem. PDF escaneado não cai aqui: as
 * páginas dele vão para o Word como imagem.
 */
export class PdfWithoutTextError extends Error {
  constructor() {
    super("Este PDF não tem conteúdo nenhum para levar ao Word: as páginas estão em branco.");
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

/** Alinhamento de uma imagem dentro da caixa onde ela fica. */
function imageAlignment(image: PlacedImage, box: { left: number; right: number }): "left" | "center" | "right" {
  const width = box.right - box.left;
  const leftGap = image.x - box.left;
  const rightGap = box.right - (image.x + image.width);
  return Math.abs(leftGap - rightGap) <= Math.max(4, width * 0.03) ? "center"
    : rightGap < leftGap ? "right"
    : "left";
}

const isNearWhite = (c: Rgb) => c.r > 245 && c.g > 245 && c.b > 245;

/**
 * Fundo colorido por trás de um retângulo de texto: o preenchimento sólido que
 * o cobre inteiro. É o que guarda a faixa vermelha de um título ou a barra
 * lateral de um currículo — e, com ela, o texto branco que fica por cima, que
 * sem o fundo sumiria no Word, branco sobre branco.
 */
function backgroundOf(
  fills: FilledArea[],
  box: { left: number; right: number; top: number; bottom: number },
): FilledArea | null {
  let best: FilledArea | null = null;
  for (const f of fills) {
    if (isNearWhite(f.color)) continue;
    const covers =
      f.x <= box.left + 1 && f.x + f.width >= box.right - 1 &&
      f.y <= box.top + 1 && f.y + f.height >= box.bottom - 1;
    if (!covers) continue;
    // O menor que cobre é o mais próximo do texto: uma célula sombreada dentro
    // de uma página com fundo, e não o fundo da página.
    if (!best || f.width * f.height < best.width * best.height) best = f;
  }
  return best;
}

/**
 * Área com colunas (informativo, barra lateral de currículo) como tabela de uma
 * linha, sem bordas, uma célula por coluna.
 *
 * As fronteiras entre as células se encostam: é a borda do fundo colorido,
 * quando há um, ou o meio do vão entre as colunas. As margens da célula repõem
 * a distância entre essa fronteira e o texto, para o texto cair no mesmo x do
 * original. Com fundo, a linha ganha altura mínima: a barra lateral desce até
 * onde descia, mesmo quando o texto dela acaba antes.
 */
function areaTable(
  segment: Extract<PageSegment, { kind: "columns" }>,
  fills: FilledArea[],
  pageImages: PlacedImage[],
  paragraphsOf: (lines: TextLine[], box: { left: number; right: number }) => Paragraph[],
): DocTable {
  const { columns } = segment;
  const taken = new Set<PlacedImage>();
  const prepared = columns.map((column, c) => {
    const previous = columns[c - 1];
    const next = columns[c + 1];
    const lo = previous ? (previous.right + column.left) / 2 : -Infinity;
    const hi = next ? (column.right + next.left) / 2 : Infinity;
    const inside = pageImages.filter((img) => {
      if (taken.has(img)) return false;
      const cx = img.x + img.width / 2;
      const cy = img.y + img.height / 2;
      return cx >= lo && cx < hi && cy >= segment.top - 40 && cy <= segment.bottom + 40;
    });
    inside.forEach((img) => taken.add(img));
    const top = Math.min(column.lines[0].top, ...inside.map((i) => i.y));
    const bottom = Math.max(column.lines[column.lines.length - 1].bottom, ...inside.map((i) => i.y + i.height));
    const background = backgroundOf(fills, { left: column.left, right: column.right, top, bottom });
    return { column, inside, top, bottom, background };
  });

  const bounds: number[] = [];
  prepared.forEach((p, i) => {
    if (i === 0) {
      bounds.push(Math.min(p.column.left, p.background?.x ?? Infinity));
      return;
    }
    const before = prepared[i - 1];
    bounds.push(
      before.background ? before.background.x + before.background.width
      : p.background ? p.background.x
      : (before.column.right + p.column.left) / 2,
    );
  });
  const lastP = prepared[prepared.length - 1];
  bounds.push(Math.max(lastP.column.right, lastP.background ? lastP.background.x + lastP.background.width : -Infinity));

  const anyBackground = prepared.some((p) => p.background);
  const top = Math.min(segment.top, ...prepared.map((p) => Math.min(p.top, p.background?.y ?? Infinity)));
  const bottom = Math.max(segment.bottom, ...prepared.map((p) => Math.max(p.bottom, p.background ? p.background.y + p.background.height : -Infinity)));

  const cells: TableCell[] = prepared.map((p, i) => {
    const left = bounds[i];
    const right = bounds[i + 1];
    // A borda direita do texto da coluna sai das quebras de linha, e não da
    // linha mais comprida — que deixaria a célula mais estreita que o original.
    const textRight = Math.min(right, Math.max(p.column.right, estimateRightEdge(p.column.lines, null)));
    const padding = {
      left: Math.max(0, p.column.left - left),
      right: Math.max(0, right - textRight),
      top: Math.max(0, p.top - top),
    };
    return {
      paragraphs: paragraphsOf(p.column.lines, { left: p.column.left, right: textRight }),
      images: p.inside.map((image) => ({ image, alignment: imageAlignment(image, { left: p.column.left, right: p.column.right }) })),
      left, right, top, bottom,
      header: false,
      borders: { top: false, right: false, bottom: false, left: false, color: { r: 0, g: 0, b: 0 }, thickness: 0.5 },
      shading: p.background?.color ?? null,
      span: 1,
      rowSpan: 1,
      padding,
    };
  });

  return {
    rows: [{ cells, top, bottom, height: anyBackground ? bottom - top : null }],
    left: bounds[0],
    right: bounds[bounds.length - 1],
    top,
    bottom,
    columnWidths: bounds.slice(1).map((x, i) => Math.max(8, x - bounds[i])),
  };
}

/** Ordena parágrafos, tabelas e imagens de uma página pela posição vertical. */
function orderPage(
  paragraphs: Paragraph[],
  tables: DocTable[],
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
    entries.push({
      top: image.y,
      bottom: image.y + image.height,
      item: { kind: "image", image, alignment: imageAlignment(image, contentBox), spaceAfter: 0 },
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
  const pdf = await openPdfjs(data, options.password);
  const pageCount = pdf.numPages;

  // ---- 1 e 2: extração e linhas, página a página ----
  const pages: { content: PageContent; lines: TextLine[]; gutters: Gutter[]; grids: RuledGrid[] }[] = [];
  for (let i = 1; i <= pageCount; i++) {
    report(4 + (i / pageCount) * 46, `Lendo a página ${i} de ${pageCount}...`);
    const page = await pdf.getPage(i);
    const content = await extractPage(
      pdfjsLib as unknown as Parameters<typeof extractPage>[0],
      page as unknown as Parameters<typeof extractPage>[1],
      i - 1,
    );

    // Tabela tem caminho próprio (grade de traços ou árvore de estrutura): os
    // vãos entre as colunas dela não são rios entre colunas de texto.
    const structById = new Map(content.structBlocks.map((b) => [b.order, b]));
    const inStructTable = (r: TextRun) =>
      r.structBlock !== null && (structById.get(r.structBlock)?.table ?? null) !== null;
    const inBox = (r: TextRun, g: { left: number; right: number; top: number; bottom: number }) =>
      r.x >= g.left - 2 && r.x + r.width <= g.right + 2 && r.baseline >= g.top - 2 && r.baseline <= g.bottom + 2;
    // A grade de traços é a geometria exata da tabela, e vale também no PDF
    // marcado. Ali, porém, só conta a grade que contém texto de uma tabela da
    // árvore: uma moldura em volta de um parágrafo não é tabela.
    const grids = detectRuledGrids(content.rules).filter(
      (g) => !content.structBlocks.length || content.runs.some((r) => inStructTable(r) && inBox(r, g)),
    );
    const inGrid = (r: TextRun) => grids.some((g) => inBox(r, g));
    // As tabelas não geram rios, mas continuam ocupando o espaço delas.
    const obstacles = grids.map((g) => ({ left: g.left, right: g.right, top: g.top, bottom: g.bottom }));
    const tableBoxes = new Map<number, { left: number; right: number; top: number; bottom: number }>();
    for (const r of content.runs) {
      if (!inStructTable(r) || !r.text.trim()) continue;
      const id = structById.get(r.structBlock!)!.table!;
      const box = tableBoxes.get(id);
      const top = r.baseline - r.style.size * 0.78;
      const bottom = r.baseline + r.style.size * 0.22;
      if (!box) tableBoxes.set(id, { left: r.x, right: r.x + r.width, top, bottom });
      else {
        box.left = Math.min(box.left, r.x);
        box.right = Math.max(box.right, r.x + r.width);
        box.top = Math.min(box.top, top);
        box.bottom = Math.max(box.bottom, bottom);
      }
    }
    obstacles.push(...tableBoxes.values());
    // Imagens ocupam espaço como o texto: a do meio de uma coluna não abre um
    // vão que encerre a coluna, e a que atravessa a página encerra o rio.
    // Fundo de página e marca d'água, do tamanho da folha, ficam de fora.
    for (const img of content.images) {
      if (img.width > content.width * 0.9 && img.height > content.height * 0.5) continue;
      obstacles.push({ left: img.x, right: img.x + img.width, top: img.y, bottom: img.y + img.height });
    }
    const gutters = findGutters(content.runs.filter((r) => !inStructTable(r) && !inGrid(r)), obstacles);

    const lines = groupIntoLines(content.runs, {
      gutters,
      barriers: content.rules
        .filter((r) => r.axis === "v" && r.to - r.from > 4)
        .map((r) => ({ x: r.position, top: r.from, bottom: r.to })),
      sameLineBlocks: content.structBlocks.length
        ? (a, b) => {
            const A = structById.get(a);
            const B = structById.get(b);
            return Boolean(A && B && A.listItem !== null && A.listItem === B.listItem);
          }
        : undefined,
    });
    decorateLines(lines, content);
    pages.push({ content, lines, gutters, grids });
  }

  const pagesWithoutText = pages.filter((p) => !p.lines.length).length;
  if (pagesWithoutText === pageCount && !pages.some((p) => p.content.images.length)) throw new PdfWithoutTextError();

  // ---- 3: cabeçalho, rodapé e margens ----
  report(54, "Separando cabeçalho e rodapé...");
  const bands: PageBands[] = classifyBands(pages);
  const withBands = pages.map((page, index) => ({ content: page.content, bands: bands[index] }));
  const section = planSection(withBands);
  // Uma seção do Word por sequência de páginas do mesmo tamanho.
  const parts: DocumentPart[] = groupPagesBySize(withBands).map((group) => ({
    group,
    body: [],
    contentLeft: group.margins.left,
    contentRight: group.pageWidth - group.margins.right,
  }));
  const partOf = (index: number) => parts.find((p) => index >= p.group.start && index <= p.group.end) ?? parts[0];

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
  const footnotes: Footnote[] = [];
  let footnoteCounter = 0;
  for (let index = 0; index < pages.length; index++) {
    report(56 + (index / pages.length) * 34, `Montando a página ${index + 1} de ${pageCount}...`);
    const page = pages[index];
    const tagged = page.content.structBlocks.length > 0;
    const part = partOf(index);
    const body = part.body;
    // Primeira página de uma seção nova: a quebra de seção já começa a página.
    const startsPart = index === part.group.start;
    const contentBox = { left: part.contentLeft, right: part.contentRight };

    // Sem árvore de estrutura, as tabelas são reconhecidas pelos traços e as
    // linhas que caem dentro delas saem do fluxo de texto antes de virarem
    // parágrafos — senão o conteúdo das células vira uma frase corrida.
    const paragraphsOf = (source: TextLine[], box: { left: number; right: number }, top?: number) =>
      buildParagraphs(source, box, page.content.structBlocks, top)
        .map((p) => (p.list ? stripListMarker(p) : p))
        .filter((p) => p.lines.some((l) => l.text.trim().length > 0));

    let images = page.content.images.filter(
      (i) =>
        !usedImages.has(i) &&
        !runningFootprints.has(`${Math.round(i.x)},${Math.round(i.y)},${Math.round(i.width)}x${Math.round(i.height)}`),
    );
    const takeImages = (used: Set<PlacedImage>) => {
      if (used.size) images = images.filter((img) => !used.has(img));
    };
    const tables: DocTable[] = [];

    // Notas de rodapé saem do corpo antes de tudo: no Word elas moram no pé da
    // página, chamadas pelo número elevado do texto.
    const extracted = extractFootnotes(
      bands[index].body,
      page.content.rules,
      contentBox,
      page.content.height,
      () => ++footnoteCounter,
    );
    footnotes.push(...extracted.notes);

    // Tabelas com grade de traços: a geometria exata, com mescla e altura.
    let bodyLines = extracted.body;
    for (const grid of page.grids) {
      const { table, used, usedImages: inTable } = buildRuledTable(
        grid,
        bodyLines,
        page.content.rules,
        page.content.fills,
        (cellLines, cellBox) => paragraphsOf(cellLines, cellBox),
        images,
      );
      if (!table.rows.some((r) => r.cells.some((c) => c.paragraphs.length || c.images.length))) continue;
      tables.push(table);
      takeImages(inTable);
      bodyLines = bodyLines.filter((l) => !used.has(l));
    }

    // Tabelas da árvore de estrutura sem grade (layout de currículo, por
    // exemplo): as linhas delas não entram nas áreas, a árvore já diz a célula.
    const structById = new Map(page.content.structBlocks.map((b) => [b.order, b]));
    const isTableLine = (l: TextLine) =>
      tagged && l.structBlock !== null && (structById.get(l.structBlock)?.table ?? null) !== null;
    const tableLines = bodyLines.filter(isTableLine);
    if (tableLines.length) {
      const built = buildStructTables(
        tableLines,
        page.content.structBlocks,
        page.content.rules,
        page.content.fills,
        images,
        (cellLines, cellBox) => paragraphsOf(cellLines, cellBox),
        page.content,
      );
      tables.push(...built.tables);
      takeImages(built.usedImages);
    }

    const segments = partitionPage(bodyLines.filter((l) => !isTableLine(l)), page.gutters);
    const flowParagraphs: Paragraph[] = [];
    let firstFlow = true;
    for (const segment of segments) {
      if (segment.kind === "flow") {
        flowParagraphs.push(...paragraphsOf(segment.lines, contentBox, firstFlow ? part.group.margins.top : undefined));
        firstFlow = false;
        continue;
      }
      // Área com colunas: uma tabela sem bordas, de uma linha, uma célula
      // por coluna, com o fundo e as imagens que estão dentro de cada coluna.
      const table = areaTable(segment, page.content.fills, images, paragraphsOf);
      takeImages(new Set(table.rows[0].cells.flatMap((c) => c.images.map((i) => i.image))));
      tables.push(table);
    }

    // Fundo de parágrafo: a faixa colorida por trás de um título.
    for (const p of flowParagraphs) {
      const left = Math.min(...p.lines.map((l) => l.left));
      const right = Math.max(...p.lines.map((l) => l.right));
      p.shading = backgroundOf(page.content.fills, { left, right, top: p.top, bottom: p.bottom })?.color ?? null;
    }

    // Página escaneada (sem texto nenhum): as imagens dela vão na posição
    // exata da página, que é o que o original mostra. Sem reconhecimento de
    // texto não dá para editar, mas o conteúdo não some do documento.
    const ordered: BodyItem[] = page.lines.length
      ? orderPage(flowParagraphs, tables, images, contentBox)
      : page.content.images.map((image) => ({ kind: "page-image" as const, image }));

    // Só emenda com o que está de fato no fim do documento montado até aqui;
    // um parágrafo anterior seguido de uma tabela ou de uma imagem já não é
    // continuação de nada.
    const tail = body[body.length - 1];
    const openParagraph = tail?.kind === "paragraph" ? tail.paragraph : undefined;
    const first = ordered[0];
    const continues =
      !startsPart &&
      first?.kind === "paragraph" &&
      continuesAcrossPages(openParagraph, first.paragraph);

    if (!startsPart && !continues) body.push({ kind: "page-break" });

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
  const plan: DocumentPlan = { section, parts, footnotes };
  const blob = await buildDocx(docx, plan);

  report(100, "Concluído");
  return { blob, pages: pageCount, pagesWithoutText };
}
