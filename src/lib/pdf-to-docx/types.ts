/**
 * Modelo intermediário entre o PDF e o DOCX.
 *
 * Um PDF não guarda parágrafos, listas nem tabelas: guarda glifos com
 * coordenadas, imagens com matrizes e traços vetoriais. O DOCX, ao contrário,
 * só sabe falar de parágrafos, runs e tabelas. Este arquivo define o modelo do
 * meio — o que a extração produz e o que o gerador consome —, para que nenhum
 * dos dois lados precise conhecer o outro.
 *
 * Todas as medidas são em **pontos tipográficos** (1pt = 1/72"), que é a
 * unidade nativa do PDF, com a origem no **canto superior esquerdo** da página
 * e o eixo Y crescendo para baixo. O PDF usa a origem embaixo; a conversão é
 * feita uma única vez, na extração, para o resto do código nunca precisar
 * pensar nisso.
 */

/** Cor RGB com componentes de 0 a 255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Retângulo com origem no canto superior esquerdo da página. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Estilo de caractere, já traduzido do nome da fonte do PDF. */
export interface TextStyle {
  /** Nome de família utilizável no Word, sem o prefixo de subconjunto. */
  family: string;
  /** Tamanho em pontos. */
  size: number;
  bold: boolean;
  italic: boolean;
  color: Rgb;
}

/**
 * Um pedaço de texto desenhado pelo PDF, com sua caixa na página.
 *
 * A extração não tenta juntar nada: cada `showText` do PDF vira um run. Juntar
 * é trabalho de `lines.ts`, que tem o contexto de linha inteira para decidir
 * onde cabe um espaço e onde não cabe.
 */
export interface TextRun {
  text: string;
  /** Borda esquerda do primeiro glifo. */
  x: number;
  /** Linha de base, medida de cima para baixo. */
  baseline: number;
  /** Largura desenhada, em pontos. */
  width: number;
  style: TextStyle;
  /**
   * Verdadeiro quando o PDF marcou o trecho como `Artifact` — a etiqueta que o
   * Word usa para cabeçalho, rodapé, número de página e arte de fundo. É um
   * indício forte, mas só existe em PDFs marcados, então nunca é a única prova.
   */
  artifact: boolean;
  /** Fim de linha declarado pelo próprio PDF. */
  endsLine: boolean;
  /**
   * Bloco da árvore de estrutura a que este trecho pertence, quando o PDF é
   * marcado. É a informação mais valiosa que um PDF pode dar: em vez de
   * adivinhar onde termina um parágrafo pela distância entre as linhas, lê-se
   * do arquivo qual parágrafo, item de lista ou célula de tabela é cada
   * pedaço de texto. PDFs de scanner e geradores antigos não têm essa árvore,
   * e aí o valor é `null` e vale a heurística geométrica.
   */
  structBlock: number | null;
}

/** Papéis da árvore de estrutura que viram um bloco no documento. */
export type StructRole =
  | "P" | "H1" | "H2" | "H3" | "H4" | "H5" | "H6"
  | "Lbl" | "LBody" | "TD" | "TH" | "Caption" | "Figure" | "Title" | "Other";

/** Um bloco da árvore de estrutura, na ordem de leitura do documento. */
export interface StructBlock {
  order: number;
  role: StructRole;
  /** Caminho de papéis do topo até a folha, para saber aninhamento de listas. */
  path: string[];
  /**
   * Índice do item de lista (`LI`) que contém este bloco, quando há um, e
   * profundidade do aninhamento de listas. Dois `LBody` com o mesmo `listItem`
   * pertencem ao mesmo marcador.
   */
  listItem: number | null;
  listDepth: number;
  /** Índices das linhas de tabela e célula que contêm este bloco, quando há. */
  tableRow: number | null;
  tableCell: number | null;
  table: number | null;
}

/** Imagem desenhada na página, com a caixa que o CTM produziu. */
export interface PlacedImage extends Rect {
  /** PNG já codificado, pronto para entrar no DOCX. */
  data: Uint8Array;
  /** Pixels do bitmap original, para o DOCX não reamostrar à toa. */
  pixelWidth: number;
  pixelHeight: number;
  /** Ordem de desenho na página: quem vem antes fica atrás. */
  order: number;
}

/**
 * Um traço vetorial reduzido ao que interessa para reconstruir documentos:
 * segmentos horizontais e verticais. Curvas e diagonais são descartadas, porque
 * o DOCX não tem onde guardá-las e elas nunca formam grade de tabela.
 */
export interface RuleSegment {
  /** "h" para horizontal, "v" para vertical. */
  axis: "h" | "v";
  /** Coordenada constante do segmento (y para "h", x para "v"). */
  position: number;
  /** Início e fim ao longo do eixo em que o segmento se estende. */
  from: number;
  to: number;
  thickness: number;
  color: Rgb;
  /** Traço vindo de um retângulo preenchido, e não de um contorno. */
  filled: boolean;
}

/** Área preenchida com cor sólida — vira sombreamento de célula ou parágrafo. */
export interface FilledArea extends Rect {
  color: Rgb;
  order: number;
}

/** Link do PDF, para virar hiperlink no DOCX. */
export interface PdfLink extends Rect {
  url: string;
}

/** Tudo o que foi extraído de uma página. */
export interface PageContent {
  index: number;
  width: number;
  height: number;
  runs: TextRun[];
  images: PlacedImage[];
  rules: RuleSegment[];
  fills: FilledArea[];
  links: PdfLink[];
  /** Vazio quando o PDF não é marcado. */
  structBlocks: StructBlock[];
}
