/**
 * Leitura do XML do OOXML.
 *
 * O DOCX é um pacote de XMLs com prefixos de namespace (`w:`, `a:`, `wp:`…).
 * Aqui tudo é lido pelo nome local, sem depender do prefixo que o editor usou:
 * o Word grava `w:`, mas há geradores que gravam outro prefixo para o mesmo
 * namespace, e o XML continua válido.
 */

export function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) throw new Error("Este arquivo Word está corrompido: um dos XMLs internos não pôde ser lido.");
  return doc;
}

/** Filhos elementos, opcionalmente só os de um nome local. */
export function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (!name || c.localName === name) out.push(c);
  }
  return out;
}

/** Primeiro filho elemento com o nome local. */
export function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) return c;
  return null;
}

/** Descendente pelo caminho de nomes locais: `path(el, "pPr", "spacing")`. */
export function path(el: Element | null | undefined, ...names: string[]): Element | null {
  let current: Element | null | undefined = el;
  for (const n of names) current = kid(current, n);
  return current ?? null;
}

/** Todos os descendentes com o nome local, em ordem de documento. */
export function descendants(el: Element | null | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagName("*")).filter((e) => e.localName === name);
}

/** Atributo pelo nome local, com ou sem prefixo (`w:val`, `val`, `r:id`). */
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) {
    if (a.localName === name) return a.value;
  }
  return null;
}

/** `w:val` de um filho: `val(pPr, "jc")`. */
export function val(el: Element | null | undefined, name: string): string | null {
  return attr(kid(el, name), "val");
}

/** Número de um atributo, ou `null`. */
export function num(el: Element | null | undefined, name: string): number | null {
  const v = attr(el, name);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Propriedade liga/desliga do Word (`<w:b/>`, `<w:b w:val="0"/>`): `true`,
 * `false` ou `null` quando o elemento não existe.
 */
export function onOff(el: Element | null | undefined, name: string): boolean | null {
  const k = kid(el, name);
  if (!k) return null;
  const v = attr(k, "val");
  return v === null || !(v === "0" || v === "false" || v === "off");
}

/** Twips (1/20 de ponto) para pontos. */
export const twip = (v: number | null): number | null => (v === null ? null : v / 20);
/** EMU (1/12700 de ponto) para pontos. */
export const emu = (v: number | null): number | null => (v === null ? null : v / 12700);
