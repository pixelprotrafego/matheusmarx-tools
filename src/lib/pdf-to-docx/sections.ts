/**
 * Descobre a página: tamanho, margens, cabeçalho e rodapé.
 *
 * No PDF não existe "cabeçalho": existe texto desenhado perto do topo, igual em
 * todas as páginas. Se ele for tratado como corpo, o Word recebe o endereço do
 * escritório repetido no meio do texto a cada página — que é o defeito clássico
 * de conversor de PDF para Word e o que faz o arquivo parecer quebrado.
 *
 * Aqui a separação usa duas provas independentes, porque nenhuma das duas
 * sozinha é confiável:
 *
 * - a etiqueta `Artifact`, que o Word grava em cabeçalho, rodapé e arte de
 *   fundo — precisa, mas só existe em PDF marcado;
 * - a repetição do mesmo texto, na mesma altura, em páginas diferentes — vale
 *   em qualquer PDF, mas precisa de pelo menos duas páginas.
 */

import type { TextLine } from "./lines";
import type { PageContent, PlacedImage } from "./types";

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Distância do topo da página até o topo do cabeçalho. */
  header: number;
  /** Distância da base da página até a base do rodapé. */
  footer: number;
}

export interface PageBands {
  header: TextLine[];
  footer: TextLine[];
  body: TextLine[];
}

export interface RunningContent {
  lines: TextLine[];
  images: PlacedImage[];
  /** Assinatura usada para saber se duas páginas têm o mesmo cabeçalho. */
  signature: string;
}

export interface SectionPlan {
  pageWidth: number;
  pageHeight: number;
  landscape: boolean;
  margins: Margins;
  /** Cabeçalho e rodapé da primeira página, quando diferem dos demais. */
  firstPageHeader: RunningContent | null;
  firstPageFooter: RunningContent | null;
  defaultHeader: RunningContent | null;
  defaultFooter: RunningContent | null;
  /** Verdadeiro quando a primeira página tem cabeçalho ou rodapé próprios. */
  differentFirstPage: boolean;
}

/** Fração da altura da página em que se procura cabeçalho e rodapé. */
const BAND = 0.18;

/**
 * Texto da linha com os números trocados por `#`.
 *
 * "Página 3 de 12" e "Página 4 de 12" são o mesmo cabeçalho com o número da
 * página trocado; sem apagar os dígitos, cada página pareceria um cabeçalho
 * diferente e nenhum seria reconhecido.
 */
const signatureOf = (line: TextLine): string =>
  line.text.replace(/\s+/g, " ").replace(/\d+/g, "#").trim().toLowerCase();

/** A linha é só um número de página? */
export const isPageNumberLine = (line: TextLine): boolean =>
  /^\s*(p[áa]g(?:ina)?\.?\s*)?\d+\s*(?:[/|-]|de|of)?\s*\d*\s*$/i.test(line.text.trim());

/**
 * Separa cabeçalho, rodapé e corpo em cada página.
 *
 * Uma linha só é promovida a cabeçalho ou rodapé se estiver na faixa das bordas
 * **e** tiver uma das duas provas: a etiqueta `Artifact` ou repetição entre
 * páginas. Um título que por acaso comece no alto da primeira página continua
 * sendo corpo, que é o que se quer.
 */
export function classifyBands(pages: { content: PageContent; lines: TextLine[] }[]): PageBands[] {
  const repeats = new Map<string, Set<number>>();

  for (const page of pages) {
    const { height } = page.content;
    for (const line of page.lines) {
      const inBand = line.top < height * BAND || line.bottom > height * (1 - BAND);
      if (!inBand) continue;
      const key = `${signatureOf(line)}@${Math.round(line.baseline / 6)}`;
      if (!repeats.has(key)) repeats.set(key, new Set());
      repeats.get(key)!.add(page.content.index);
    }
  }

  // Com duas páginas, repetir nas duas basta; com muitas, exige-se maioria,
  // para uma coincidência isolada não virar cabeçalho.
  const total = pages.length;
  const needed = total <= 2 ? 2 : Math.max(2, Math.ceil(total * 0.5));

  return pages.map((page) => {
    const { height } = page.content;
    const header: TextLine[] = [];
    const footer: TextLine[] = [];
    const body: TextLine[] = [];

    for (const line of page.lines) {
      const top = line.top < height * BAND;
      const bottom = line.bottom > height * (1 - BAND);
      if (!top && !bottom) {
        body.push(line);
        continue;
      }

      const key = `${signatureOf(line)}@${Math.round(line.baseline / 6)}`;
      const repeated = (repeats.get(key)?.size ?? 0) >= needed;
      // Uma única página não tem como provar repetição; aí só a etiqueta vale,
      // e um número solto na borda também é claramente número de página.
      const running = line.artifact || repeated || (total === 1 && isPageNumberLine(line));

      if (!running) body.push(line);
      else if (top) header.push(line);
      else footer.push(line);
    }

    return { header, footer, body };
  });
}

/**
 * Margens da seção, medidas na união das páginas.
 *
 * A margem é sempre a menor encontrada: se numa página o texto chega mais perto
 * da borda, é essa a margem verdadeira do documento — usar a média cortaria
 * conteúdo dessa página ao reabrir no Word.
 */
export function measureMargins(
  pages: { content: PageContent; bands: PageBands }[],
): Margins {
  const pageHeight = pages[0]?.content.height ?? 842;
  const pageWidth = pages[0]?.content.width ?? 595;

  const bodyLines = pages.flatMap((p) => p.bands.body);
  const headerLines = pages.flatMap((p) => p.bands.header);
  const footerLines = pages.flatMap((p) => p.bands.footer);

  const fallback = { top: 72, right: 72, bottom: 72, left: 72 };
  if (!bodyLines.length) {
    return { ...fallback, header: 36, footer: 36 };
  }

  const left = Math.min(...bodyLines.map((l) => l.left));
  const right = pageWidth - Math.max(...bodyLines.map((l) => l.right));
  const top = Math.min(...bodyLines.map((l) => l.top));
  const bottom = pageHeight - Math.max(...bodyLines.map((l) => l.bottom));

  const headerAt = headerLines.length ? Math.min(...headerLines.map((l) => l.top)) : top / 2;
  const footerAt = footerLines.length ? pageHeight - Math.max(...footerLines.map((l) => l.bottom)) : bottom / 2;

  // Uma margem negativa ou absurda significa que a medição pegou algo que não
  // é corpo; o padrão de 1 polegada é mais seguro do que um valor inventado.
  const sane = (value: number, standard: number) =>
    Number.isFinite(value) && value >= 0 && value < pageHeight * 0.45 ? Math.round(value * 10) / 10 : standard;

  return {
    top: sane(top, fallback.top),
    right: sane(right, fallback.right),
    bottom: sane(bottom, fallback.bottom),
    left: sane(left, fallback.left),
    header: sane(Math.min(headerAt, top), 36),
    footer: sane(Math.min(footerAt, bottom), 36),
  };
}

/**
 * Imagens que pertencem ao cabeçalho: as que ficam na faixa do topo e as que
 * são maiores que a página inteira — fundo de página e marca d'água, que no
 * Word moram no cabeçalho, atrás do texto.
 */
const belongsToRunningContent = (image: PlacedImage, page: PageContent, band: "header" | "footer"): boolean => {
  const coversPage = image.width > page.width * 0.95 && image.height > page.height * 0.9;
  if (coversPage) return band === "header";
  if (band === "header") return image.y + image.height <= page.height * BAND + 4;
  return image.y >= page.height * (1 - BAND) - 4;
};

const runningSignature = (lines: TextLine[], images: PlacedImage[]): string =>
  [
    ...lines.map((l) => `${signatureOf(l)}@${Math.round(l.baseline / 4)}`),
    ...images.map((i) => `img@${Math.round(i.x)},${Math.round(i.y)},${Math.round(i.width)}x${Math.round(i.height)}`),
  ]
    .sort()
    .join("|");

const collect = (
  page: { content: PageContent; bands: PageBands },
  band: "header" | "footer",
): RunningContent => {
  const lines = band === "header" ? page.bands.header : page.bands.footer;
  const images = page.content.images.filter((i) => belongsToRunningContent(i, page.content, band));
  return { lines, images, signature: runningSignature(lines, images) };
};

/** Monta o plano da seção a partir de todas as páginas do documento. */
export function planSection(
  pages: { content: PageContent; bands: PageBands }[],
): SectionPlan {
  const first = pages[0];
  const pageWidth = first?.content.width ?? 595.28;
  const pageHeight = first?.content.height ?? 841.89;

  const headers = pages.map((p) => collect(p, "header"));
  const footers = pages.map((p) => collect(p, "footer"));

  const empty = (r: RunningContent) => !r.lines.length && !r.images.length;

  // O Word tem a opção "primeira página diferente"; é o que explica um PDF cujo
  // cabeçalho da capa não é o das demais. Só se usa quando há uma segunda
  // página para comparar.
  const rest = headers.slice(1).concat(footers.slice(1));
  const restHeader = headers.slice(1).find((h) => !empty(h)) ?? null;
  const restFooter = footers.slice(1).find((f) => !empty(f)) ?? null;

  const headerDiffers =
    pages.length > 1 && restHeader !== null && headers[0].signature !== restHeader.signature;
  const footerDiffers =
    pages.length > 1 && restFooter !== null && footers[0].signature !== restFooter.signature;
  const differentFirstPage = headerDiffers || footerDiffers;
  void rest;

  return {
    pageWidth,
    pageHeight,
    landscape: pageWidth > pageHeight,
    margins: measureMargins(pages),
    firstPageHeader: differentFirstPage && !empty(headers[0]) ? headers[0] : null,
    firstPageFooter: differentFirstPage && !empty(footers[0]) ? footers[0] : null,
    defaultHeader: differentFirstPage ? restHeader : (headers.find((h) => !empty(h)) ?? null),
    defaultFooter: differentFirstPage ? restFooter : (footers.find((f) => !empty(f)) ?? null),
    differentFirstPage,
  };
}
