/**
 * Modelo do documento Word já resolvido: estilos aplicados, numeração
 * calculada, unidades em pontos. É o que a montagem da página consome — ela
 * nunca precisa olhar o XML nem saber de herança de estilo.
 */

export interface Border {
  /** Espessura em pontos (0 = sem borda). */
  width: number;
  color: string;
  style: "solid" | "double" | "dashed" | "dotted";
  /** Distância entre a borda e o texto, em pontos. */
  space: number;
}

export interface RunProps {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: "single" | "double" | "dotted" | "dashed" | "wave" | null;
  strike: boolean;
  doubleStrike: boolean;
  /** Cor em #rrggbb; `null` = automática (preto). */
  color: string | null;
  highlight: string | null;
  shading: string | null;
  vertAlign: "superscript" | "subscript" | null;
  caps: boolean;
  smallCaps: boolean;
  hidden: boolean;
  /** Espaçamento entre letras, em pontos. */
  spacing: number;
  /** Deslocamento vertical (elevado/rebaixado), em pontos. */
  position: number;
}

export interface TabStop {
  /** Posição a partir da margem esquerda da coluna, em pontos. */
  pos: number;
  align: "left" | "center" | "right" | "decimal" | "bar" | "clear";
  leader: "none" | "dot" | "hyphen" | "underscore" | "middleDot";
}

export interface ParaProps {
  styleId: string | null;
  align: "left" | "center" | "right" | "justify";
  indLeft: number;
  indRight: number;
  /** Primeira linha: positivo = recuo, negativo = deslocamento (pendente). */
  indFirst: number;
  spaceBefore: number;
  spaceAfter: number;
  /** Entrelinha: múltiplo (auto), exata ou mínima, em pontos ou fator. */
  line: number;
  lineRule: "auto" | "exact" | "atLeast";
  contextual: boolean;
  keepNext: boolean;
  keepLines: boolean;
  pageBreakBefore: boolean;
  widowControl: boolean;
  /** Linha única, sem quebra (texto de célula de planilha). */
  noWrap?: boolean;
  tabs: TabStop[];
  shading: string | null;
  borders: { top?: Border; bottom?: Border; left?: Border; right?: Border; between?: Border };
  /** Propriedades do caractere de fim de parágrafo: dão a altura da linha vazia. */
  markProps: RunProps;
}

export interface ImageRef {
  /** Bytes da imagem, como estão no pacote. */
  data: Uint8Array;
  mime: string;
  /** Tamanho desenhado, em pontos. */
  width: number;
  height: number;
}

/** Posição de um objeto flutuante (imagem ou caixa de texto). */
export interface Anchor {
  hRelative: "page" | "margin" | "column" | "paragraph" | "character" | "leftMargin" | "rightMargin" | "insideMargin" | "outsideMargin";
  hAlign: "left" | "center" | "right" | "inside" | "outside" | null;
  hOffset: number;
  vRelative: "page" | "margin" | "paragraph" | "line" | "topMargin" | "bottomMargin" | "insideMargin" | "outsideMargin";
  vAlign: "top" | "center" | "bottom" | "inside" | "outside" | null;
  vOffset: number;
  wrap: "none" | "square" | "tight" | "through" | "topAndBottom";
  behind: boolean;
  /** Distância do texto ao redor, em pontos. */
  distLeft: number;
  distRight: number;
  distTop: number;
  distBottom: number;
  z: number;
}

export interface Watermark {
  text: string;
  font: string;
  color: string;
  /** 0 a 1. */
  opacity: number;
  /** Giro em graus, no sentido horário (como no VML). */
  rotation: number;
}

export interface Shape {
  geometry: "rect" | "roundRect" | "ellipse" | "line";
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

export type Inline =
  | { kind: "text"; text: string; props: RunProps; link?: string }
  | { kind: "tab"; props: RunProps }
  | { kind: "break"; type: "line" | "page" | "column"; props: RunProps }
  | {
      kind: "field";
      field: "PAGE" | "NUMPAGES" | "SECTIONPAGES";
      props: RunProps;
      fallback: string;
      /** Formato pedido no próprio campo (PAGE com a opção "\* roman"), no vocabulário do w:numFmt. */
      format?: string;
    }
  | { kind: "image"; image: ImageRef; props: RunProps; anchor: Anchor | null }
  | {
      kind: "box"; width: number; height: number; blocks: Block[]; shape: Shape | null; anchor: Anchor | null; props: RunProps;
      padding: [number, number, number, number];
      /** Marca d'água de texto (WordArt do VML): o texto preenche a caixa, girado. */
      watermark?: Watermark;
    }
  | { kind: "footnote"; id: string; props: RunProps };

export interface Paragraph {
  kind: "p";
  props: ParaProps;
  /** Marcador de lista já formatado ("1.", "a)", "•"), quando há. */
  marker: { text: string; props: RunProps; suffix: "tab" | "space" | "nothing" } | null;
  inlines: Inline[];
  /**
   * Só marca uma quebra de página que fechava o parágrafo anterior: não ocupa
   * espaço, mas o que vem depois começa na página seguinte.
   */
  breakOnly?: boolean;
}

export interface Cell {
  span: number;
  vMerge: "restart" | "continue" | null;
  width: number | null;
  shading: string | null;
  borders: { top?: Border; bottom?: Border; left?: Border; right?: Border };
  vAlign: "top" | "center" | "bottom";
  margins: { top: number; right: number; bottom: number; left: number };
  blocks: Block[];
  /**
   * Quanto o conteúdo pode invadir as células vizinhas (vazias) à esquerda e
   * à direita, em pontos; além disso ele é cortado. Como o texto do Excel.
   */
  overflow?: { left: number; right: number; clipToCell?: boolean };
}

export interface Row {
  height: number | null;
  heightRule: "auto" | "atLeast" | "exact";
  header: boolean;
  cantSplit: boolean;
  /** Quebra de página manual antes desta linha (planilha). */
  breakBefore?: boolean;
  cells: Cell[];
  /** Colunas da grade puladas antes da primeira célula (`gridBefore`). */
  gridBefore: number;
}

export interface Table {
  kind: "table";
  /** Larguras das colunas da grade, em pontos. */
  grid: number[];
  /** Largura declarada da tabela: em pontos ou em % da largura disponível. */
  width: { type: "pt" | "pct"; value: number } | null;
  /** Layout fixo (`tblLayout` fixed); senão, ajuste automático ao conteúdo. */
  fixed: boolean;
  /**
   * Bordas desenhadas sobre as linhas da grade, sem ocupar espaço na célula
   * (como no Excel). No Word, a borda fica dentro da célula.
   */
  gridBorders?: boolean;
  align: "left" | "center" | "right";
  indent: number;
  rows: Row[];
}

export type Block = Paragraph | Table;

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
  gutter: number;
}

export interface SectionProps {
  pageWidth: number;
  pageHeight: number;
  margins: Margins;
  columns: { count: number; space: number; separator: boolean; widths: number[] | null };
  type: "nextPage" | "continuous" | "evenPage" | "oddPage" | "nextColumn";
  titlePage: boolean;
  headers: { default?: Block[]; first?: Block[]; even?: Block[] };
  footers: { default?: Block[]; first?: Block[]; even?: Block[] };
  pageNumberStart: number | null;
  /** Formato do número de página da seção (w:pgNumType w:fmt): lowerRoman, upperRoman... */
  pageNumberFormat?: string | null;
}

export interface Section {
  props: SectionProps;
  blocks: Block[];
}

export interface DocModel {
  sections: Section[];
  footnotes: Map<string, Block[]>;
  /** Notas de fim, com a chave "e" + id (para não colidir com as de rodapé). */
  endnotes: Map<string, Block[]>;
  evenAndOddHeaders: boolean;
  /** Distância entre as tabulações padrão, em pontos. */
  defaultTab: number;
  /**
   * Modo de compatibilidade do Word que gravou o arquivo (15 = Word 2013 ou
   * mais novo; 12 = Word 2007, que também vale quando o arquivo não diz).
   */
  compatMode: number;
  /** Fonte do estilo Normal (dá a altura da linha do separador das notas). */
  normalRun: RunProps;
}
