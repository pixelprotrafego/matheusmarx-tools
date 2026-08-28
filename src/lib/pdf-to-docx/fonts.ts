/**
 * Tradução do nome de fonte do PDF para o que o Word entende.
 *
 * O PDF não guarda "Calibri em negrito": guarda uma fonte chamada
 * `BCDHEE+Calibri-Bold`, com um prefixo aleatório de seis letras que marca um
 * subconjunto embutido, e o estilo colado no nome. O Word, do outro lado, quer
 * a família ("Calibri") e o estilo como atributos separados.
 *
 * Sem essa tradução todo o documento sai com a fonte padrão do Word, que foi
 * exatamente um dos motivos de o resultado antigo não parecer com o original.
 */

/** Sufixos que os geradores de PDF colam no nome e que não são família. */
const POSTSCRIPT_SUFFIXES = ["PSMT", "MT", "PS", "Std", "Pro", "LT", "BT"];

/** Palavras de estilo reconhecidas dentro do nome da fonte. */
const STYLE_TOKENS = new Set([
  "regular", "normal", "roman", "book", "text",
  "bold", "black", "heavy", "extrabold", "ultrabold", "semibold", "demibold",
  "light", "thin", "extralight", "ultralight", "medium",
  "italic", "oblique", "it",
  "condensed", "narrow", "extended", "expanded", "caption", "display",
]);

const BOLD_TOKENS = new Set(["bold", "black", "heavy", "extrabold", "ultrabold"]);
const ITALIC_TOKENS = new Set(["italic", "oblique", "it"]);

/**
 * As 14 fontes que todo leitor de PDF tem embutidas. Elas quase nunca existem
 * com esse nome no Windows, então são trocadas pelo equivalente instalado —
 * senão o Word substitui por conta própria e a métrica muda.
 */
const BASE14: Record<string, string> = {
  helvetica: "Arial",
  arial: "Arial",
  times: "Times New Roman",
  timesnewroman: "Times New Roman",
  timesroman: "Times New Roman",
  courier: "Courier New",
  couriernew: "Courier New",
  symbol: "Symbol",
  zapfdingbats: "Wingdings",
};

/** Famílias genéricas do CSS, que é tudo o que o pdf.js devolve sem a fonte. */
const GENERIC_FALLBACK: Record<string, string> = {
  "sans-serif": "Arial",
  serif: "Times New Roman",
  monospace: "Courier New",
  cursive: "Segoe Script",
  fantasy: "Arial",
};

export interface ParsedFont {
  family: string;
  bold: boolean;
  italic: boolean;
}

/** Quebra "BoldItalic" ou "SemiBoldOblique" nas palavras que o compõem. */
const splitGlued = (chunk: string): string[] => {
  const parts: string[] = [];
  let rest = chunk;
  // As palavras compostas vêm primeiro para "SemiBold" não virar "Semi"+"Bold".
  const vocabulary = [...STYLE_TOKENS].sort((a, b) => b.length - a.length);
  while (rest.length) {
    const found = vocabulary.find((word) => rest.toLowerCase().startsWith(word));
    if (!found) return parts.length ? [...parts, rest] : [rest];
    parts.push(found);
    rest = rest.slice(found.length);
  }
  return parts;
};

/** Só é sufixo de estilo se **todas** as palavras do trecho forem estilo. */
const isStyleChunk = (chunk: string): boolean => {
  if (!chunk) return false;
  const words = splitGlued(chunk);
  return words.length > 0 && words.every((w) => STYLE_TOKENS.has(w.toLowerCase()));
};

/**
 * "TimesNewRoman" -> "Times New Roman"; "Arial" continua "Arial".
 *
 * O último passo desfaz a separação dentro dos nomes de peso compostos: o Word
 * conhece a família como "Aptos SemiBold", e "Aptos Semi Bold" não existe —
 * escrever assim faz o Word substituir a fonte e mudar o desenho da letra.
 */
const spaceOutCamelCase = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b(Semi|Demi|Extra|Ultra) (Bold|Light|Condensed|Expanded)\b/g, "$1$2");

/**
 * Converte o nome bruto de uma fonte de PDF em família, negrito e itálico.
 *
 * `fallback` é o `fallbackName` do pdf.js — uma família genérica de CSS — e só
 * entra quando o nome real não veio, o que acontece em PDFs sem fonte embutida.
 */
export function parseFontName(rawName: string | null | undefined, fallback?: string): ParsedFont {
  const fallbackFamily = GENERIC_FALLBACK[(fallback ?? "").toLowerCase()] ?? "Calibri";
  if (!rawName) return { family: fallbackFamily, bold: false, italic: false };

  // Prefixo de subconjunto: seis maiúsculas e um "+".
  let name = rawName.replace(/^[A-Z]{6}\+/, "").trim();
  if (!name) return { family: fallbackFamily, bold: false, italic: false };

  let bold = false;
  let italic = false;

  const applyStyle = (chunk: string) => {
    for (const word of splitGlued(chunk)) {
      const w = word.toLowerCase();
      if (BOLD_TOKENS.has(w)) bold = true;
      if (ITALIC_TOKENS.has(w)) italic = true;
    }
  };

  // Estilo depois da vírgula: é assim que o Word grava ("Aptos SemiBold,Bold").
  // Aqui a vírgula é definitiva — o que vem antes é família, inclusive quando a
  // família termina em algo que parece estilo.
  const comma = name.indexOf(",");
  if (comma >= 0) {
    applyStyle(name.slice(comma + 1).replace(/[\s-]/g, ""));
    name = name.slice(0, comma).trim();
  }

  // Sufixos PostScript grudados no fim, antes de olhar o hífen: em
  // "TimesNewRomanPS-BoldMT" o "MT" esconde a palavra "Bold".
  const stripSuffixes = (value: string) => {
    let out = value;
    let changed = true;
    while (changed) {
      changed = false;
      for (const suffix of POSTSCRIPT_SUFFIXES) {
        if (out.length > suffix.length && out.endsWith(suffix)) {
          out = out.slice(0, -suffix.length);
          changed = true;
        }
      }
    }
    return out;
  };

  name = stripSuffixes(name);

  // Depois do hífen só pode vir estilo: "Calibri-Bold", "TimesNewRomanPS-BoldMT".
  let guard = 0;
  while (guard++ < 4) {
    const at = name.lastIndexOf("-");
    if (at <= 0) break;
    const tail = stripSuffixes(name.slice(at + 1));
    if (!isStyleChunk(tail)) break;
    applyStyle(tail);
    name = name.slice(0, at).trim();
  }

  // Depois do espaço a regra é mais estrita: só corta quando a palavra final é
  // de fato negrito ou itálico. "Arial Bold" vira "Arial" + negrito, mas
  // "Aptos SemiBold" e "Arial Narrow" continuam inteiros, porque o Word conhece
  // essas duas como famílias próprias e trocá-las mudaria o desenho da letra.
  guard = 0;
  while (guard++ < 4) {
    const at = name.lastIndexOf(" ");
    if (at <= 0) break;
    const tail = stripSuffixes(name.slice(at + 1));
    if (!isStyleChunk(tail)) break;
    const words = splitGlued(tail).map((w) => w.toLowerCase());
    if (!words.some((w) => BOLD_TOKENS.has(w) || ITALIC_TOKENS.has(w))) break;
    applyStyle(tail);
    name = name.slice(0, at).trim();
  }

  name = stripSuffixes(name).replace(/[-_\s]+$/, "").trim();
  if (!name) return { family: fallbackFamily, bold, italic };

  const key = name.toLowerCase().replace(/[\s-]/g, "");
  const family = BASE14[key] ?? spaceOutCamelCase(name);

  return { family: family || fallbackFamily, bold, italic };
}
