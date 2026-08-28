/**
 * Gera o arquivo .docx a partir do plano do documento.
 *
 * Este módulo não decide nada sobre o conteúdo: ele só traduz o que os módulos
 * anteriores concluíram para o vocabulário do Word. Toda a conversão de unidade
 * mora aqui, num lugar só, porque o OOXML mistura quatro delas — twips para
 * página e recuo, meio-ponto para corpo de letra, pixel para imagem e EMU para
 * posição de imagem flutuante — e misturá-las foi historicamente a origem de
 * documentos que abrem com tudo no tamanho errado.
 */

import type {
  ILevelsOptions,
  Paragraph as DocxParagraph,
  ParagraphChild,
  Table as DocxTable,
} from "docx";

import type { Paragraph as ParagraphPlan } from "./blocks";
import type { LineRun, TextLine } from "./lines";
import type { RunningContent, SectionPlan } from "./sections";
import type { DocTable } from "./tables";
import type { PlacedImage, Rgb } from "./types";

/** Um item do corpo do documento, na ordem de leitura. */
export type BodyItem =
  | { kind: "paragraph"; paragraph: ParagraphPlan }
  | { kind: "table"; table: DocTable }
  | { kind: "image"; image: PlacedImage; alignment: "left" | "center" | "right"; spaceAfter: number }
  | { kind: "page-break" };

export interface DocumentPlan {
  section: SectionPlan;
  body: BodyItem[];
  /** Caixa de conteúdo da página, em pontos, para medir recuos. */
  contentLeft: number;
  contentRight: number;
}

// ---------------------------------------------------------------- unidades

/** 1pt = 20 twips. É a unidade de página, margem, recuo e espaçamento. */
const twip = (points: number) => Math.round(points * 20);
/** O corpo da letra no OOXML é contado em meio-pontos. */
const halfPoint = (points: number) => Math.max(2, Math.round(points * 2));
/** A biblioteca `docx` recebe imagem em pixel de CSS, a 96 dpi. */
const pixels = (points: number) => Math.max(1, Math.round((points * 96) / 72));
/** 1pt = 12700 EMU. É a unidade da âncora de imagem flutuante. */
const emu = (points: number) => Math.round(points * 12700);

const hex = (c: Rgb) =>
  [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const isBlack = (c: Rgb) => c.r < 12 && c.g < 12 && c.b < 12;

// ------------------------------------------------------------------ runs

type DocxModule = typeof import("docx");

const buildRun = (docx: DocxModule, run: LineRun, forceColor?: string) => {
  const { TextRun, UnderlineType } = docx;
  const options: ConstructorParameters<typeof TextRun>[0] = {
    text: run.text,
    font: run.style.family,
    size: halfPoint(run.style.size),
    bold: run.style.bold || undefined,
    italics: run.style.italic || undefined,
    // Preto é o padrão do Word; escrever "000000" em todo run infla o arquivo
    // sem mudar nada na tela.
    color: forceColor ?? (isBlack(run.style.color) ? undefined : hex(run.style.color)),
    superScript: run.vertical === "superscript" || undefined,
    subScript: run.vertical === "subscript" || undefined,
    underline: run.underline ? { type: UnderlineType.SINGLE } : undefined,
    strike: run.strike || undefined,
  };
  return new TextRun(options);
};

/**
 * Converte as linhas de um parágrafo em runs de um parágrafo só.
 *
 * As linhas do PDF são emendadas com um espaço, e **não** com quebra manual de
 * linha. A tentação é copiar as quebras do PDF, porque o resultado na tela fica
 * idêntico — mas um .docx cheio de quebras manuais não é um documento do Word,
 * é a fotografia de um PDF dentro de um .docx: ao mudar uma palavra, uma fonte
 * ou uma margem, o texto não reflui e o parágrafo se desmancha. Com as margens,
 * a fonte e a entrelinha corretas, o Word reproduz as mesmas quebras sozinho, e
 * o arquivo continua editável.
 *
 * Linha terminada em hífen é emendada sem espaço: tanto faz se o hífen é da
 * palavra ("terça-feira" partida na quebra) ou da hifenização automática, em
 * nenhum dos dois casos entra espaço ali.
 */
const runsOfLines = (docx: DocxModule, lines: TextLine[]): ParagraphChild[] => {
  const { ExternalHyperlink } = docx;
  const children: ParagraphChild[] = [];
  let previousText = "";

  lines.forEach((line, index) => {
    let pendingSpace = index > 0 && !/[-‐­\s]$/.test(previousText);

    for (const run of line.runs) {
      if (!run.text) continue;
      const needsSpace = pendingSpace && !/^\s/.test(run.text);
      pendingSpace = false;

      // Num trecho com link, o espaço que vem antes fica fora do link: se
      // entrasse dentro, o sublinhado azul começaria uma letra antes da URL.
      let body = run.text;
      if (run.link) {
        const lead = /^\s+/.exec(body)?.[0] ?? "";
        const prefix = (needsSpace ? " " : "") + lead;
        if (prefix) {
          children.push(buildRun(docx, { ...run, text: prefix, link: undefined, underline: undefined }));
          body = body.slice(lead.length);
        }
      }
      const text = needsSpace && !run.link ? " " + body : body;
      const built = buildRun(docx, { ...run, text });
      children.push(
        run.link ? new ExternalHyperlink({ children: [built], link: run.link }) : built,
      );
      previousText = text;
    }
  });

  return children;
};

// ------------------------------------------------------------- numeração

interface NumberingPlan {
  reference: string;
  levels: ILevelsOptions[];
}

const ROMAN = /^[ivxlcdm]+$/i;

/**
 * Fontes em que o código do caractere não corresponde ao Unicode.
 *
 * O Word grava a bala como o caractere 0xF0B7 da fonte Symbol; o pdf.js já
 * traduz isso para o "•" do Unicode ao ler. Se esse "•" for gravado de volta
 * *com a fonte Symbol*, o Word vai procurar o "•" dentro da Symbol, não achar,
 * e desenhar um quadradinho vazio no lugar da bala. Por isso o marcador vindo
 * de uma fonte simbólica é gravado sem fonte nenhuma: em qualquer fonte de
 * texto o "•" existe e sai igual ao original.
 */
const SYMBOLIC_FONTS = new Set(["symbol", "wingdings", "wingdings 2", "wingdings 3", "webdings", "zapfdingbats"]);

const markerFontFor = (family: string): string | undefined =>
  SYMBOLIC_FONTS.has(family.trim().toLowerCase()) ? undefined : family;

/** Formato de numeração deduzido do marcador que estava no PDF. */
const levelFormatOf = (docx: DocxModule, marker: string) => {
  const { LevelFormat } = docx;
  const body = marker.replace(/[.)\]]+$/, "");
  if (/^\d+$/.test(body)) return LevelFormat.DECIMAL;
  if (ROMAN.test(body)) return /[IVXLCDM]/.test(body) ? LevelFormat.UPPER_ROMAN : LevelFormat.LOWER_ROMAN;
  if (/^[A-Z]$/.test(body)) return LevelFormat.UPPER_LETTER;
  if (/^[a-z]$/.test(body)) return LevelFormat.LOWER_LETTER;
  return LevelFormat.DECIMAL;
};

/**
 * Monta a numeração de uma lista preservando o marcador original.
 *
 * O marcador vira o texto do nível, e não um genérico do Word: se o documento
 * usava "▪" ou "a)", é isso que reaparece. Trocar por outro símbolo mudaria a
 * aparência de uma coisa que já estava decidida no arquivo de origem.
 */
const numberingFor = (
  docx: DocxModule,
  reference: string,
  items: { level: number; kind: "bullet" | "number"; marker: string; font: string; indentLeft: number; hanging: number }[],
): NumberingPlan => {
  const { AlignmentType } = docx;
  const byLevel = new Map<number, (typeof items)[number]>();
  for (const item of items) if (!byLevel.has(item.level)) byLevel.set(item.level, item);

  const levels: ILevelsOptions[] = [];
  for (let level = 0; level <= Math.max(...items.map((i) => i.level)); level++) {
    const model = byLevel.get(level) ?? items[0];
    const punctuation = /[.)\]]$/.exec(model.marker)?.[0] ?? "";
    levels.push({
      level,
      format: model.kind === "bullet" ? docx.LevelFormat.BULLET : levelFormatOf(docx, model.marker),
      text: model.kind === "bullet" ? model.marker : `%${level + 1}${punctuation}`,
      alignment: AlignmentType.LEFT,
      style: {
        run: model.kind === "bullet" ? { font: markerFontFor(model.font) } : undefined,
        paragraph: {
          indent: { left: twip(model.indentLeft), hanging: twip(Math.max(model.hanging, 6)) },
        },
      },
    });
  }

  return { reference, levels };
};

// ------------------------------------------------------------- parágrafos

const alignmentOf = (docx: DocxModule, value: ParagraphPlan["alignment"]) => {
  const { AlignmentType } = docx;
  switch (value) {
    case "center": return AlignmentType.CENTER;
    case "right": return AlignmentType.RIGHT;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return AlignmentType.LEFT;
  }
};

/**
 * Recuos de um parágrafo, descontando o que é só efeito do alinhamento.
 *
 * A medição enxerga "espaço à esquerda" tanto num parágrafo recuado quanto num
 * parágrafo centralizado — mas só no primeiro isso é recuo. Gravar o recuo de
 * um título centralizado faria o Word centralizar dentro do recuo e empurrar o
 * título para a direita, que é o defeito clássico de conversor de PDF.
 *
 * Do lado direito vale um cuidado parecido: numa linha curta alinhada à
 * esquerda, a distância até a margem é só onde a frase acabou. Recuo à direita
 * de verdade se reconhece por várias linhas parando no mesmo ponto, bem antes
 * da margem.
 */
const indentsFor = (plan: ParagraphPlan) => {
  if (plan.alignment === "center") return { left: 0, right: 0 };

  const rightIsReal =
    plan.alignment === "justify" ||
    plan.alignment === "right" ||
    (plan.lines.length > 1 && plan.indentRight > 12);

  const base = {
    left: twip(plan.alignment === "right" ? 0 : plan.indentLeft),
    right: twip(rightIsReal ? plan.indentRight : 0),
  };

  if (plan.alignment === "right") return base;
  if (plan.indentFirstLine > 0.5) return { ...base, firstLine: twip(plan.indentFirstLine) };
  if (plan.indentFirstLine < -0.5) return { ...base, hanging: twip(-plan.indentFirstLine) };
  return base;
};

const paragraphOptions = (
  docx: DocxModule,
  plan: ParagraphPlan,
  numbering: { reference: string; level: number } | null,
  pageBreakBefore: boolean,
) => {
  const { LineRuleType } = docx;

  // Entrelinha exata mantém a paginação igual à do PDF. Só se aplica quando o
  // valor medido faz sentido: uma entrelinha menor que a letra viria de um
  // erro de medição e cortaria o texto no Word.
  const usableLine = plan.lineSpacing > (plan.lines[0]?.fontSize ?? 0) * 0.9 ? plan.lineSpacing : 0;

  return {
    alignment: alignmentOf(docx, plan.alignment),
    pageBreakBefore: pageBreakBefore || undefined,
    spacing: {
      after: twip(plan.spaceAfter),
      before: twip(plan.spaceBefore),
      ...(usableLine ? { line: twip(usableLine), lineRule: LineRuleType.EXACT } : {}),
    },
    // Num item de lista o recuo vem da própria numeração; repeti-lo aqui
    // empurraria o texto duas vezes.
    indent: numbering ? undefined : indentsFor(plan),
    numbering: numbering ?? undefined,
    outlineLevel: plan.outlineLevel > 0 ? plan.outlineLevel - 1 : undefined,
  };
};

// --------------------------------------------------------------- imagens

const imageRun = (docx: DocxModule, image: PlacedImage) =>
  new docx.ImageRun({
    type: "png",
    data: image.data,
    transformation: { width: pixels(image.width), height: pixels(image.height) },
  });

/**
 * Imagem ancorada à página e atrás do texto.
 *
 * É como o Word guarda fundo de página e marca d'água. Ficar atrás do texto é o
 * que impede que a faixa do cabeçalho cubra as letras que estão sobre ela.
 *
 * O `zIndex` reproduz a ordem em que o PDF desenhou. Sem ele, duas imagens
 * atrás do texto empilham numa ordem que o Word escolhe, e o fundo de página —
 * que é opaco e cobre a folha inteira — apaga a faixa colorida do cabeçalho
 * desenhada depois dele.
 */
const floatingImageRun = (docx: DocxModule, image: PlacedImage) =>
  new docx.ImageRun({
    type: "png",
    data: image.data,
    transformation: { width: pixels(image.width), height: pixels(image.height) },
    floating: {
      horizontalPosition: { relative: docx.HorizontalPositionRelativeFrom.PAGE, offset: emu(image.x) },
      verticalPosition: { relative: docx.VerticalPositionRelativeFrom.PAGE, offset: emu(image.y) },
      behindDocument: true,
      allowOverlap: true,
      zIndex: image.order + 1,
      wrap: { type: docx.TextWrappingType.NONE },
    },
  });

// --------------------------------------------------------------- tabelas

const borderSide = (docx: DocxModule, on: boolean, color: Rgb, thickness: number) =>
  on
    ? { style: docx.BorderStyle.SINGLE, size: Math.max(2, Math.round(thickness * 8)), color: hex(color) }
    : { style: docx.BorderStyle.NONE, size: 0, color: "auto" };

const buildTable = (
  docx: DocxModule,
  table: DocTable,
  renderParagraph: (plan: ParagraphPlan) => DocxParagraph,
) => {
  const { Table, TableRow, TableCell, WidthType, Paragraph } = docx;

  return new Table({
    width: { size: twip(table.right - table.left), type: WidthType.DXA },
    columnWidths: table.columnWidths.map(twip),
    layout: docx.TableLayoutType.FIXED,
    rows: table.rows.map(
      (row) =>
        new TableRow({
          tableHeader: row.cells.some((c) => c.header) || undefined,
          children: row.cells.map((cell, index) => {
            const children = cell.paragraphs.map(renderParagraph);
            return new TableCell({
              width: { size: twip(table.columnWidths[index] ?? table.columnWidths[0] ?? 60), type: WidthType.DXA },
              // Uma célula vazia sem parágrafo nenhum deixa o arquivo inválido.
              children: children.length ? children : [new Paragraph({})],
              shading: cell.shading ? { fill: hex(cell.shading) } : undefined,
              borders: {
                top: borderSide(docx, cell.borders.top, cell.borders.color, cell.borders.thickness),
                bottom: borderSide(docx, cell.borders.bottom, cell.borders.color, cell.borders.thickness),
                left: borderSide(docx, cell.borders.left, cell.borders.color, cell.borders.thickness),
                right: borderSide(docx, cell.borders.right, cell.borders.color, cell.borders.thickness),
              },
            });
          }),
        }),
    ),
  });
};

// ------------------------------------------------- cabeçalho e rodapé

const buildRunningContent = (
  docx: DocxModule,
  running: RunningContent,
  box: { left: number; right: number },
  kind: "header" | "footer",
) => {
  const { Header, Footer, Paragraph, TextRun, PageNumber, AlignmentType } = docx;
  const children: DocxParagraph[] = [];

  // As imagens de fundo entram primeiro e ficam atrás de tudo.
  for (const image of running.images) {
    children.push(new Paragraph({ children: [floatingImageRun(docx, image)], spacing: { after: 0, line: 20, lineRule: docx.LineRuleType.EXACT } }));
  }

  // Entrelinha do cabeçalho medida no próprio PDF: um valor arbitrário
  // comprimiria ou espalharia as linhas do endereço, que no original estão a
  // uma distância bem definida umas das outras.
  const gaps: number[] = [];
  for (let i = 1; i < running.lines.length; i++) {
    const gap = running.lines[i].baseline - running.lines[i - 1].baseline;
    if (gap > 1 && gap < 100) gaps.push(gap);
  }
  const runningLeading = gaps.length
    ? gaps.slice().sort((a, b) => a - b)[gaps.length >> 1]
    : (running.lines[0]?.fontSize ?? 10) * 1.15;

  for (const line of running.lines) {
    const width = box.right - box.left;
    const leftGap = line.left - box.left;
    const rightGap = box.right - line.right;
    let alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT;
    if (Math.abs(leftGap - rightGap) <= Math.max(2, width * 0.02) && leftGap > width * 0.05) {
      alignment = AlignmentType.CENTER;
    } else if (rightGap < width * 0.06 && leftGap > width * 0.1) {
      alignment = AlignmentType.RIGHT;
    }

    // Número de página vira campo, e não texto fixo: se ficasse texto, todas
    // as páginas do Word mostrariam o número da página em que foi copiado.
    const numeric = /^\s*(p[áa]g(?:ina)?\.?\s*)?(\d+)\s*(?:de|of|\/)?\s*(\d+)?\s*$/i.exec(line.text.trim());
    const style = line.runs[0]?.style;
    if (numeric && style) {
      const parts: ParagraphChild[] = [];
      const common = {
        font: style.family,
        size: halfPoint(style.size),
        bold: style.bold || undefined,
        color: isBlack(style.color) ? undefined : hex(style.color),
      };
      if (numeric[1]) parts.push(new TextRun({ ...common, text: numeric[1] }));
      parts.push(new TextRun({ ...common, children: [PageNumber.CURRENT] }));
      if (numeric[3]) {
        parts.push(new TextRun({ ...common, text: " de " }));
        parts.push(new TextRun({ ...common, children: [PageNumber.TOTAL_PAGES] }));
      }
      children.push(new Paragraph({ alignment, spacing: { after: 0 }, children: parts }));
      continue;
    }

    children.push(
      new Paragraph({
        alignment,
        spacing: { after: 0, line: twip(runningLeading), lineRule: docx.LineRuleType.EXACT },
        children: line.runs.filter((r) => r.text).map((r) => buildRun(docx, r)),
      }),
    );
  }

  if (!children.length) children.push(new Paragraph({}));
  return kind === "header" ? new Header({ children }) : new Footer({ children });
};

// ------------------------------------------------------------ documento

/** Monta o documento inteiro e devolve o .docx pronto. */
export async function buildDocx(docx: DocxModule, plan: DocumentPlan): Promise<Blob> {
  const { Document, Packer, Paragraph, PageBreak, AlignmentType } = docx;
  const box = { left: plan.contentLeft, right: plan.contentRight };

  // Cada sequência de itens de lista vira uma numeração própria, para o Word
  // recomeçar a contagem onde o documento original recomeçava.
  const numberings: NumberingPlan[] = [];
  const listReference = new Map<ParagraphPlan, { reference: string; level: number }>();
  {
    let group: { paragraph: ParagraphPlan; item: Parameters<typeof numberingFor>[2][number] }[] = [];
    const flush = () => {
      if (!group.length) return;
      const reference = `lista-${numberings.length + 1}`;
      numberings.push(numberingFor(docx, reference, group.map((g) => g.item)));
      for (const g of group) listReference.set(g.paragraph, { reference, level: g.item.level });
      group = [];
    };

    for (const entry of plan.body) {
      if (entry.kind !== "paragraph" || !entry.paragraph.list) {
        // Só um item de lista logo em seguida continua a mesma lista.
        if (entry.kind !== "paragraph") flush();
        else if (!entry.paragraph.list) flush();
        continue;
      }
      const p = entry.paragraph;
      group.push({
        paragraph: p,
        item: {
          level: p.list.level,
          kind: p.list.kind,
          marker: p.list.marker,
          font: p.list.markerFont,
          indentLeft: p.indentLeft,
          // O recuo pendente é a distância do marcador até o texto, medida no
          // próprio PDF; um valor fixo aproximaria ou afastaria o marcador.
          hanging: Math.max(p.indentLeft - p.list.markerIndent, 6),
        },
      });
    }
    flush();
  }

  const renderParagraph = (item: ParagraphPlan, pageBreakBefore = false) =>
    new Paragraph({
      ...paragraphOptions(docx, item, listReference.get(item) ?? null, pageBreakBefore),
      children: runsOfLines(docx, item.lines),
    });

  const children: (DocxParagraph | DocxTable)[] = [];
  // A quebra de página vira propriedade do parágrafo seguinte, e não um
  // parágrafo vazio só para carregar a quebra: o parágrafo vazio aparece como
  // uma linha em branco no topo da página nova, que não existe no original.
  let breakPending = false;

  for (const entry of plan.body) {
    switch (entry.kind) {
      case "paragraph":
        children.push(renderParagraph(entry.paragraph, breakPending));
        breakPending = false;
        break;
      case "table":
        // Tabela não tem "quebrar antes"; aqui a quebra precisa de um
        // parágrafo próprio mesmo.
        if (breakPending) {
          children.push(new Paragraph({ children: [new PageBreak()], spacing: { after: 0, before: 0 } }));
          breakPending = false;
        }
        children.push(buildTable(docx, entry.table, (p) => renderParagraph(p)));
        // O Word exige um parágrafo entre duas tabelas e depois da última.
        children.push(new Paragraph({ spacing: { after: 0, before: 0 } }));
        break;
      case "image":
        children.push(
          new Paragraph({
            alignment:
              entry.alignment === "center" ? AlignmentType.CENTER
              : entry.alignment === "right" ? AlignmentType.RIGHT
              : AlignmentType.LEFT,
            pageBreakBefore: breakPending || undefined,
            spacing: { after: twip(entry.spaceAfter) },
            children: [imageRun(docx, entry.image)],
          }),
        );
        breakPending = false;
        break;
      case "page-break":
        breakPending = true;
        break;
    }
  }

  if (breakPending) {
    children.push(new Paragraph({ children: [new PageBreak()], spacing: { after: 0, before: 0 } }));
  }

  const { section } = plan;
  const document = new Document({
    numbering: numberings.length ? { config: numberings.map((n) => ({ reference: n.reference, levels: n.levels })) } : undefined,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
          paragraph: { spacing: { after: 0, line: 240, lineRule: docx.LineRuleType.AUTO } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: twip(section.pageWidth),
              height: twip(section.pageHeight),
              orientation: section.landscape ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT,
            },
            margin: {
              top: twip(section.margins.top),
              right: twip(section.margins.right),
              bottom: twip(section.margins.bottom),
              left: twip(section.margins.left),
              header: twip(section.margins.header),
              footer: twip(section.margins.footer),
            },
          },
          titlePage: section.differentFirstPage || undefined,
        },
        headers: {
          ...(section.defaultHeader ? { default: buildRunningContent(docx, section.defaultHeader, box, "header") } : {}),
          ...(section.firstPageHeader ? { first: buildRunningContent(docx, section.firstPageHeader, box, "header") } : {}),
        },
        footers: {
          ...(section.defaultFooter ? { default: buildRunningContent(docx, section.defaultFooter, box, "footer") } : {}),
          ...(section.firstPageFooter ? { first: buildRunningContent(docx, section.firstPageFooter, box, "footer") } : {}),
        },
        children,
      },
    ],
  });

  return Packer.toBlob(document);
}
