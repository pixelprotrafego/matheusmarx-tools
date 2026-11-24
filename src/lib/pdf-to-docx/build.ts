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
import type { PageGroup, RunningContent, SectionPlan } from "./sections";
import type { CellImage, DocTable } from "./tables";
import type { Footnote } from "./footnotes";
import type { PlacedImage, Rgb } from "./types";

/** Um item do corpo do documento, na ordem de leitura. */
export type BodyItem =
  | { kind: "paragraph"; paragraph: ParagraphPlan }
  | { kind: "table"; table: DocTable }
  | { kind: "image"; image: PlacedImage; alignment: "left" | "center" | "right"; spaceAfter: number }
  /** Imagem de página escaneada, na posição exata da página. */
  | { kind: "page-image"; image: PlacedImage }
  | { kind: "page-break" };

/** Uma seção do Word: páginas do mesmo tamanho e o corpo delas. */
export interface DocumentPart {
  group: PageGroup;
  body: BodyItem[];
  /** Caixa de conteúdo da página, em pontos, para medir recuos. */
  contentLeft: number;
  contentRight: number;
}

export interface DocumentPlan {
  /** Cabeçalho, rodapé e "primeira página diferente", do documento inteiro. */
  section: SectionPlan;
  parts: DocumentPart[];
  /** Notas de rodapé reconhecidas, chamadas no texto pelo id. */
  footnotes: Footnote[];
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
/** Paradas de tabulação coletadas ao montar um parágrafo. */
type TabStops = Map<number, "left" | "right">;

const runsOfLines = (
  docx: DocxModule,
  lines: TextLine[],
  /**
   * Caixa do parágrafo, para trocar vão largo por tabulação. Sem ela (nota
   * de rodapé, cabeçalho), o vão continua sendo um espaço.
   */
  tabs?: { left: number; right: number; stops: TabStops },
): ParagraphChild[] => {
  const { ExternalHyperlink } = docx;
  const children: ParagraphChild[] = [];
  let previousText = "";

  lines.forEach((line, index) => {
    let pendingSpace = index > 0 && !/[-‐­\s]$/.test(previousText);

    line.runs.forEach((run, k) => {
      if (!run.text) return;
      // A chamada de nota vira a referência de nota do próprio Word, que
      // numera sozinha e leva à nota no pé da página.
      if (run.footnote !== undefined) {
        children.push(new docx.FootnoteReferenceRun(run.footnote));
        previousText = run.text;
        return;
      }

      // Vão largo dentro da linha ("Data: ___      Assinatura: ___", a data
      // à direita no cabeçalho de um currículo) era um espaço só, e o que
      // vinha depois encostava no que vinha antes. Vira tabulação com parada
      // na posição exata — à direita quando o trecho termina na margem.
      const before = line.runs[k - 1];
      if (tabs && before && run.text.trim()) {
        const gap = run.x - (before.x + before.width);
        if (gap > Math.max(18, line.fontSize * 1.8)) {
          const last = line.runs.slice(k + 1).every((r) => !r.text.trim());
          const atRight = last && tabs.right - (run.x + run.width) < 3;
          const position = Math.round(((atRight ? tabs.right : run.x) - tabs.left) * 20);
          if (position > 0) {
            tabs.stops.set(position, atRight ? "right" : "left");
            children.push(new docx.TextRun({ children: [new docx.Tab()], size: halfPoint(run.style.size) }));
            const text = run.text.replace(/^\s+/, "");
            const built = buildRun(docx, { ...run, text });
            children.push(run.link ? new ExternalHyperlink({ children: [built], link: run.link }) : built);
            previousText = text;
            pendingSpace = false;
            return;
          }
        }
      }

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
    });
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
/**
 * Recuo à direita que as próprias quebras de linha exigem.
 *
 * Num parágrafo alinhado à esquerda, a linha termina antes da margem só porque
 * a palavra seguinte não coube — isso não é recuo. Recuo existe quando a
 * primeira palavra da linha seguinte *caberia* na linha de cima sem ele: aí a
 * margem efetiva do parágrafo é menor. Antes, qualquer folga acima de 12 pt
 * num parágrafo de duas linhas virava recuo, e o Word quebrava a primeira
 * linha uma palavra antes do original.
 */
const wrapIndentRight = (plan: ParagraphPlan): number => {
  if (plan.lines.length < 2) return 0;
  let limit = Infinity;
  for (let i = 0; i + 1 < plan.lines.length; i++) {
    const line = plan.lines[i];
    const first = plan.lines[i + 1].runs.find((r) => r.text.trim());
    if (!first) continue;
    const word = first.text.trim().split(/\s+/)[0];
    const perChar = first.width / Math.max(1, first.text.trimEnd().length);
    limit = Math.min(limit, line.right + line.fontSize * 0.25 + perChar * word.length);
  }
  if (!Number.isFinite(limit)) return 0;
  const needed = plan.boxRight - limit + 1;
  // Prova contraditória (a palavra não caberia nem na linha mais comprida):
  // é diferença de métrica, não recuo.
  return needed > 0 && needed <= plan.indentRight ? needed : 0;
};

const indentsFor = (plan: ParagraphPlan) => {
  if (plan.alignment === "center") return { left: 0, right: 0 };

  const rightIsReal = plan.alignment === "justify" || plan.alignment === "right";
  const right = rightIsReal ? plan.indentRight : wrapIndentRight(plan);

  const base = {
    left: twip(plan.alignment === "right" ? 0 : plan.indentLeft),
    right: twip(right),
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
    // Fundo do parágrafo: a faixa colorida que o PDF desenhou atrás dele.
    shading: plan.shading ? { type: docx.ShadingType.CLEAR, fill: hex(plan.shading), color: "auto" } : undefined,
  };
};

// --------------------------------------------------------------- imagens

const imageRun = (docx: DocxModule, image: PlacedImage) =>
  new docx.ImageRun({
    type: image.format,
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
const floatingImageRun = (docx: DocxModule, image: PlacedImage, behind = true) =>
  new docx.ImageRun({
    type: image.format,
    data: image.data,
    transformation: { width: pixels(image.width), height: pixels(image.height) },
    floating: {
      horizontalPosition: { relative: docx.HorizontalPositionRelativeFrom.PAGE, offset: emu(image.x) },
      verticalPosition: { relative: docx.VerticalPositionRelativeFrom.PAGE, offset: emu(image.y) },
      behindDocument: behind,
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

/**
 * Parágrafos e imagens de uma célula, na ordem vertical, com o espaço entre
 * eles medido de verdade.
 *
 * O "espaço depois" de um parágrafo foi medido até o parágrafo seguinte. Com
 * uma imagem no meio, esse vão já inclui a altura da imagem — e somar a imagem
 * por cima abria um buraco do tamanho dela duas vezes.
 */
const cellChildren = (
  docx: DocxModule,
  cell: DocTable["rows"][number]["cells"][number],
  renderParagraph: (plan: ParagraphPlan) => DocxParagraph,
) => {
  const { Paragraph, AlignmentType } = docx;
  type Entry =
    | { top: number; bottom: number; paragraph: ParagraphPlan }
    | { top: number; bottom: number; image: CellImage };
  const entries: Entry[] = [
    ...cell.paragraphs.map((paragraph) => ({ top: paragraph.top, bottom: paragraph.bottom, paragraph })),
    ...cell.images.map((image) => ({ top: image.image.y, bottom: image.image.y + image.image.height, image })),
  ].sort((a, b) => a.top - b.top);

  return entries.map((entry, i) => {
    const next = entries[i + 1];
    const gap = next ? Math.max(0, Math.round((next.top - entry.bottom) * 10) / 10) : 0;
    if ("paragraph" in entry) {
      if (next && "image" in next) entry.paragraph.spaceAfter = gap;
      return renderParagraph(entry.paragraph);
    }
    return new Paragraph({
      alignment:
        entry.image.alignment === "center" ? AlignmentType.CENTER
        : entry.image.alignment === "right" ? AlignmentType.RIGHT
        : AlignmentType.LEFT,
      spacing: { before: 0, after: twip(gap) },
      children: [imageRun(docx, entry.image.image)],
    });
  });
};

/**
 * Tabela: as de dados, as de layout (currículo) e as áreas com colunas.
 *
 * A largura das colunas, as mesclas, a altura mínima das linhas e as margens
 * internas saem medidas do PDF; o recuo da tabela a faz começar onde ela
 * começava, mesmo fora da margem da página — a barra lateral de um currículo
 * costuma começar antes da margem do texto.
 */
const buildTable = (
  docx: DocxModule,
  table: DocTable,
  contentLeft: number,
  renderParagraph: (plan: ParagraphPlan) => DocxParagraph,
  /** Altura útil da página: nenhuma linha pode pedir mais do que isso. */
  maxRowHeight = Infinity,
) => {
  const { Table, TableRow, TableCell, WidthType, Paragraph, HeightRule } = docx;
  // "Repetir como linha de cabeçalho" só faz sentido com corpo depois dela.
  // Numa tabela de uma linha só marcada como cabeçalho (o currículo em tabela),
  // a linha que transbordava para a página seguinte era repetida lá inteira.
  let headerRows = 0;
  while (headerRows < table.rows.length && table.rows[headerRows].cells.some((c) => c.header)) headerRows++;
  const repeatHeader = headerRows > 0 && headerRows < table.rows.length;
  const starts: number[] = [table.left];
  for (const w of table.columnWidths) starts.push(starts[starts.length - 1] + w);
  const columnAt = (x: number) => {
    let best = 0;
    for (let i = 0; i < starts.length - 1; i++) if (Math.abs(starts[i] - x) < Math.abs(starts[best] - x)) best = i;
    return best;
  };
  const none = { style: docx.BorderStyle.NONE, size: 0, color: "auto" };

  return new Table({
    width: { size: twip(table.right - table.left), type: WidthType.DXA },
    columnWidths: table.columnWidths.map(twip),
    layout: docx.TableLayoutType.FIXED,
    indent: Math.abs(table.left - contentLeft) > 1 ? { size: twip(table.left - contentLeft), type: WidthType.DXA } : undefined,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: table.rows.map(
      (row, r) =>
        new TableRow({
          tableHeader: (repeatHeader && r < headerRows) || undefined,
          // Um ponto de folga: a altura medida no PDF, somada às margens que o
          // Word acrescenta, empurrava a linha para a página seguinte.
          height: row.height ? { value: twip(Math.min(row.height, maxRowHeight) - 1), rule: HeightRule.ATLEAST } : undefined,
          children: row.cells.map((cell) => {
            const start = columnAt(cell.left);
            const span = Math.max(1, cell.span);
            const width = table.columnWidths.slice(start, start + span).reduce((a, b) => a + b, 0);
            const children = cellChildren(docx, cell, renderParagraph);
            return new TableCell({
              width: { size: twip(width || cell.right - cell.left), type: WidthType.DXA },
              columnSpan: span > 1 ? span : undefined,
              rowSpan: cell.rowSpan > 1 ? cell.rowSpan : undefined,
              margins: {
                left: twip(cell.padding.left),
                right: twip(cell.padding.right),
                // Menos de 3 pt é ruído da estimativa do topo do texto: o Word
                // usa margem zero, e somar esse ruído em cada linha de uma
                // tabela longa empurrava as últimas linhas para outra página.
                top: cell.padding.top >= 3 ? twip(Math.min(cell.padding.top, 12)) : 0,
                bottom: 0,
              },
              // Uma célula vazia sem parágrafo nenhum deixa o arquivo inválido.
              children: children.length ? children : [new Paragraph({})],
              shading: cell.shading ? { fill: hex(cell.shading), type: docx.ShadingType.CLEAR, color: "auto" } : undefined,
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
  const firstPart = plan.parts[0];
  const box = { left: firstPart?.contentLeft ?? 72, right: firstPart?.contentRight ?? 523 };

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

    const visit = (entry: BodyItem) => {
      if (entry.kind !== "paragraph" || !entry.paragraph.list) {
        // Só um item de lista logo em seguida continua a mesma lista.
        flush();
        return;
      }
      const p = entry.paragraph;
      const list = p.list!;
      group.push({
        paragraph: p,
        item: {
          level: list.level,
          kind: list.kind,
          marker: list.marker,
          font: list.markerFont,
          indentLeft: p.indentLeft,
          // O recuo pendente é a distância do marcador até o texto, medida no
          // próprio PDF; um valor fixo aproximaria ou afastaria o marcador.
          hanging: Math.max(p.indentLeft - list.markerIndent, 6),
        },
      });
    };

    for (const part of plan.parts) {
      for (const entry of part.body) {
        if (entry.kind === "table") {
          // Cada célula tem as próprias listas, que não continuam na vizinha.
          flush();
          for (const row of entry.table.rows) {
            for (const cell of row.cells) {
              for (const paragraph of cell.paragraphs) visit({ kind: "paragraph", paragraph });
              flush();
            }
          }
          continue;
        }
        visit(entry);
      }
      flush();
    }
  }

  const renderParagraph = (item: ParagraphPlan, pageBreakBefore = false) => {
    const numbering = listReference.get(item) ?? null;
    // Item de lista já tem o vão do marcador dado pela numeração.
    const tabs = numbering ? undefined : { left: item.boxLeft, right: item.boxRight, stops: new Map() as TabStops };
    const children = runsOfLines(docx, item.lines, tabs);
    const tabStops = tabs && tabs.stops.size
      ? [...tabs.stops].map(([position, type]) => ({
          type: type === "right" ? docx.TabStopType.RIGHT : docx.TabStopType.LEFT,
          position,
        }))
      : undefined;
    return new Paragraph({
      ...paragraphOptions(docx, item, numbering, pageBreakBefore),
      tabStops,
      children,
    });
  };

  const renderBody = (part: DocumentPart, last: boolean) => {
  const children: (DocxParagraph | DocxTable)[] = [];
  // A quebra de página vira propriedade do parágrafo seguinte, e não um
  // parágrafo vazio só para carregar a quebra: o parágrafo vazio aparece como
  // uma linha em branco no topo da página nova, que não existe no original.
  let breakPending = false;

  for (const entry of part.body) {
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
        children.push(
          buildTable(
            docx,
            entry.table,
            part.contentLeft,
            (p) => renderParagraph(p),
            part.group.pageHeight - part.group.margins.top - part.group.margins.bottom - 4,
          ),
        );
        // O Word exige um parágrafo entre duas tabelas e depois da última. Um
        // parágrafo vazio comum tem a altura de uma linha inteira e, depois de
        // uma tabela que vai até o pé da página, criava uma página em branco.
        children.push(new Paragraph({ spacing: { after: 0, before: 0, line: 20, lineRule: docx.LineRuleType.EXACT } }));
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
      case "page-image":
        // Ancorada à página, na frente: numa página escaneada não há texto
        // para ela cobrir, e "atrás do texto" a esconderia atrás do papel.
        children.push(
          new Paragraph({
            pageBreakBefore: breakPending || undefined,
            spacing: { after: 0, before: 0, line: 20, lineRule: docx.LineRuleType.EXACT },
            children: [floatingImageRun(docx, entry.image, false)],
          }),
        );
        breakPending = false;
        break;
      case "page-break":
        breakPending = true;
        break;
    }
  }

  // Páginas vazias no fim do documento não viram quebra: a página em branco
  // depois de um currículo que ocupa a folha inteira é só o parágrafo que o
  // Word põe depois de toda tabela, e ele a recria sozinho se for preciso.
  if (breakPending && !last) {
    children.push(new Paragraph({ children: [new PageBreak()], spacing: { after: 0, before: 0 } }));
  }
  return children;
  };

  const { section } = plan;
  const document = new Document({
    footnotes: plan.footnotes.length
      ? Object.fromEntries(
          plan.footnotes.map((note) => [
            note.id,
            { children: [new Paragraph({ spacing: { after: 0 }, children: runsOfLines(docx, note.lines) })] },
          ]),
        )
      : undefined,
    numbering: numberings.length ? { config: numberings.map((n) => ({ reference: n.reference, levels: n.levels })) } : undefined,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
          paragraph: { spacing: { after: 0, line: 240, lineRule: docx.LineRuleType.AUTO } },
        },
      },
    },
    sections: plan.parts.map((part, index) => {
      const { group } = part;
      const first = index === 0;
      return {
        properties: {
          page: {
            // A biblioteca troca largura e altura quando a orientação é
            // paisagem. Passar a largura maior junto com "paisagem" devolvia
            // uma página em pé com o rótulo de deitada, e o texto se espremia.
            size: {
              width: twip(Math.min(group.pageWidth, group.pageHeight)),
              height: twip(Math.max(group.pageWidth, group.pageHeight)),
              orientation: group.landscape ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT,
            },
            margin: {
              top: twip(group.margins.top),
              right: twip(group.margins.right),
              bottom: twip(group.margins.bottom),
              left: twip(group.margins.left),
              header: twip(group.margins.header),
              footer: twip(group.margins.footer),
            },
          },
          titlePage: (first && section.differentFirstPage) || undefined,
        },
        // Só a primeira seção declara cabeçalho e rodapé; as seguintes herdam
        // do jeito que o Word faz ("vincular ao anterior").
        ...(first
          ? {
              headers: {
                ...(section.defaultHeader ? { default: buildRunningContent(docx, section.defaultHeader, box, "header") } : {}),
                ...(section.firstPageHeader ? { first: buildRunningContent(docx, section.firstPageHeader, box, "header") } : {}),
              },
              footers: {
                ...(section.defaultFooter ? { default: buildRunningContent(docx, section.defaultFooter, box, "footer") } : {}),
                ...(section.firstPageFooter ? { first: buildRunningContent(docx, section.firstPageFooter, box, "footer") } : {}),
              },
            }
          : {}),
        children: renderBody(part, index === plan.parts.length - 1),
      };
    }),
  });

  return Packer.toBlob(document);
}
