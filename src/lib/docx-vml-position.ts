/**
 * Reposiciona as formas VML de fundo do Word.
 *
 * Modelos corporativos de Word desenham o fundo da página com uma forma VML
 * maior que a folha, centralizada, para sangrar pelas quatro bordas. O
 * posicionamento vem de propriedades `mso-position-*`, que só o Word entende.
 *
 * O `docx-preview` copia o estilo do VML literalmente para dentro de um
 * `<svg>` (veja `renderVmlElement`), então o navegador descarta essas
 * propriedades e sobra apenas o `left:0` do VML. A forma vai parar na origem da
 * caixa de conteúdo da seção — deslocada para dentro pelas margens da página —
 * e o `overflow:hidden` corta o que passou. O resultado é uma emenda vertical
 * dura, com um pedaço da página sem fundo nenhum.
 *
 * Este módulo traduz as `mso-position-*` para coordenadas reais.
 */

export type MsoAlign = "absolute" | "left" | "center" | "right" | "inside" | "outside";
export type MsoVAlign = "absolute" | "top" | "center" | "bottom" | "inside" | "outside";
/** Caixa de referência declarada pelo Word. */
export type MsoRelative = "page" | "margin" | "column" | "text" | "char" | "line";

export interface MsoPosition {
  horizontal?: MsoAlign;
  horizontalRelative?: MsoRelative;
  vertical?: MsoVAlign;
  verticalRelative?: MsoRelative;
}

/** Retângulo em pixels de CSS. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const ALIGNS = new Set(["absolute", "left", "center", "right", "inside", "outside"]);
const VALIGNS = new Set(["absolute", "top", "center", "bottom", "inside", "outside"]);
const RELATIVES = new Set(["page", "margin", "column", "text", "char", "line"]);

/** Lê as propriedades `mso-position-*` de um texto de estilo do VML. */
export function parseMsoPosition(styleText: string): MsoPosition {
  const pega = (prop: string): string | undefined => {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i").exec(styleText);
    return m ? m[1].trim().toLowerCase() : undefined;
  };

  const h = pega("mso-position-horizontal");
  const hr = pega("mso-position-horizontal-relative");
  const v = pega("mso-position-vertical");
  const vr = pega("mso-position-vertical-relative");

  return {
    horizontal: h && ALIGNS.has(h) ? (h as MsoAlign) : undefined,
    horizontalRelative: hr && RELATIVES.has(hr) ? (hr as MsoRelative) : undefined,
    vertical: v && VALIGNS.has(v) ? (v as MsoVAlign) : undefined,
    verticalRelative: vr && RELATIVES.has(vr) ? (vr as MsoRelative) : undefined,
  };
}

/** Verdadeiro quando o estilo depende de alguma propriedade `mso-position-*`. */
export const hasMsoPosition = (styleText: string): boolean =>
  /mso-position-(horizontal|vertical)/i.test(styleText);

/**
 * Converte um alinhamento em deslocamento dentro de uma caixa de referência.
 *
 * `inside` e `outside` dependem de página par ou ímpar no Word; em um PDF de
 * fluxo único, tratá-los como `left`/`right` é a leitura mais próxima.
 */
const alinhar = (
  align: string,
  refInicio: number,
  refTamanho: number,
  tamanhoForma: number,
): number => {
  switch (align) {
    case "center":
      return refInicio + (refTamanho - tamanhoForma) / 2;
    case "right":
    case "bottom":
    case "outside":
      return refInicio + refTamanho - tamanhoForma;
    case "left":
    case "top":
    case "inside":
      return refInicio;
    default:
      return NaN; // "absolute": respeita o que já estava no estilo
  }
};

export interface ResolveInput {
  mso: MsoPosition;
  /** Tamanho da forma, em px. */
  shape: { width: number; height: number };
  /** A folha inteira, incluindo as margens. Origem em (0,0). */
  page: { width: number; height: number };
  /** A área de conteúdo, já descontadas as margens da página. */
  content: Box;
}

/**
 * Calcula `left`/`top` em px relativos à borda da página.
 *
 * Devolve `null` para um eixo quando o Word não pediu alinhamento nenhum — aí o
 * valor original do estilo continua valendo e nada é tocado.
 */
export function resolveMsoOffset({ mso, shape, page, content }: ResolveInput): {
  left: number | null;
  top: number | null;
} {
  const caixaH = mso.horizontalRelative === "page"
    ? { inicio: 0, tamanho: page.width }
    : { inicio: content.left, tamanho: content.width };

  const caixaV = mso.verticalRelative === "page"
    ? { inicio: 0, tamanho: page.height }
    : { inicio: content.top, tamanho: content.height };

  const left = mso.horizontal
    ? alinhar(mso.horizontal, caixaH.inicio, caixaH.tamanho, shape.width)
    : NaN;
  const top = mso.vertical
    ? alinhar(mso.vertical, caixaV.inicio, caixaV.tamanho, shape.height)
    : NaN;

  return {
    left: Number.isFinite(left) ? left : null,
    top: Number.isFinite(top) ? top : null,
  };
}

/**
 * Uma forma que cobre a página inteira (ou mais) é fundo, e fundo tem que
 * começar na borda da folha — não na caixa de conteúdo.
 */
export const isFullBleed = (shape: { width: number; height: number }, page: { width: number; height: number }): boolean =>
  shape.width >= page.width * 0.98 || shape.height >= page.height * 0.98;
