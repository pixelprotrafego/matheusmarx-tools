/**
 * Numeração automática do Word: o "1.", "a)", "IV." e as balas das listas.
 *
 * O Word não grava o número de cada item: grava a regra (formato, texto do
 * nível, onde começa, quando recomeça) e calcula na hora. Aqui o cálculo é
 * refeito na ordem do documento, com um contador por lista.
 */

import { readPara, readRun, type ParaPatch, type RunPatch, type Theme } from "./styles";
import { attr, kid, kids, num, val } from "./xml";

interface Level {
  start: number;
  format: string;
  text: string;
  align: "left" | "center" | "right";
  suffix: "tab" | "space" | "nothing";
  restart: number | null;
  legal: boolean;
  para: ParaPatch;
  run: RunPatch;
}

interface NumInstance {
  abstractId: string;
  overrides: Map<number, { start: number | null; level: Level | null }>;
}

/**
 * Balas gravadas em fontes simbólicas (Symbol, Wingdings): o código do
 * caractere não é o Unicode do desenho. Trocadas pelo símbolo equivalente,
 * desenhado numa fonte comum.
 */
const SYMBOL_BULLETS: Record<string, string> = {
  "": "•", "": "▪", "": "➢", "": "✓", "": "❑", "": "❖",
  "": "■", "": "●", "": "◆", "": "➔", "": "➔", "": "◇",
  "": "–", "": "★", "": "➪", "": "◆",
};

export function bulletText(text: string): string {
  return [...text].map((c) => SYMBOL_BULLETS[c] ?? c).join("");
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

const roman = (n: number) => {
  let out = "";
  let rest = Math.max(1, Math.min(3999, n));
  for (const [v, s] of ROMAN) while (rest >= v) { out += s; rest -= v; }
  return out;
};

const letters = (n: number) => {
  // a..z, depois aa, bb… — o jeito do Word, e não aa, ab.
  const base = (n - 1) % 26;
  const repeat = Math.floor((n - 1) / 26) + 1;
  return String.fromCharCode(97 + base).repeat(repeat);
};

/** Número formatado no estilo do nível. */
export function formatNumber(n: number, format: string): string {
  switch (format) {
    case "lowerLetter": return letters(n);
    case "upperLetter": return letters(n).toUpperCase();
    case "lowerRoman": return roman(n).toLowerCase();
    case "upperRoman": return roman(n);
    case "decimalZero": return n < 10 ? `0${n}` : String(n);
    case "ordinal": return `${n}º`;
    case "none": return "";
    case "bullet": return "";
    default: return String(n);
  }
}

export class Numbering {
  private readonly abstracts = new Map<string, Map<number, Level>>();
  private readonly nums = new Map<string, NumInstance>();
  /** Contadores por lista: chave = numId (com reinício) ou abstractNumId. */
  private readonly counters = new Map<string, number[]>();

  constructor(doc: Document | null, theme: Theme) {
    const root = doc?.documentElement ?? null;
    const readLevel = (l: Element): Level => ({
      start: num(kid(l, "start"), "val") ?? 1,
      format: val(l, "numFmt") ?? "decimal",
      text: val(l, "lvlText") ?? "",
      align: ((): Level["align"] => {
        const j = val(l, "lvlJc");
        return j === "center" ? "center" : j === "right" || j === "end" ? "right" : "left";
      })(),
      suffix: ((): Level["suffix"] => {
        const s = val(l, "suff");
        return s === "space" ? "space" : s === "nothing" ? "nothing" : "tab";
      })(),
      restart: num(kid(l, "lvlRestart"), "val"),
      legal: kid(l, "isLgl") !== null,
      para: readPara(theme, kid(l, "pPr")),
      run: readRun(theme, kid(l, "rPr")),
    });
    for (const a of kids(root, "abstractNum")) {
      const id = attr(a, "abstractNumId");
      if (id === null) continue;
      const levels = new Map<number, Level>();
      for (const l of kids(a, "lvl")) levels.set(num(l, "ilvl") ?? 0, readLevel(l));
      this.abstracts.set(id, levels);
    }
    for (const n of kids(root, "num")) {
      const id = attr(n, "numId");
      const abstractId = val(n, "abstractNumId");
      if (id === null || abstractId === null) continue;
      const overrides = new Map<number, { start: number | null; level: Level | null }>();
      for (const o of kids(n, "lvlOverride")) {
        const ilvl = num(o, "ilvl") ?? 0;
        const lvl = kid(o, "lvl");
        overrides.set(ilvl, { start: num(kid(o, "startOverride"), "val"), level: lvl ? readLevel(lvl) : null });
      }
      this.nums.set(id, { abstractId, overrides });
    }
  }

  private level(numId: string, ilvl: number): Level | null {
    const inst = this.nums.get(numId);
    if (!inst) return null;
    return inst.overrides.get(ilvl)?.level ?? this.abstracts.get(inst.abstractId)?.get(ilvl) ?? null;
  }

  /** Recuos e propriedades do nível, para a cascata do parágrafo. */
  levelPatches(numId: string, ilvl: number): { para: ParaPatch; run: RunPatch } | null {
    const level = this.level(numId, ilvl);
    return level ? { para: level.para, run: level.run } : null;
  }

  /**
   * Avança a lista e devolve o marcador deste item. Listas que apontam para a
   * mesma definição continuam a contagem, como no Word, a não ser que a
   * instância peça para recomeçar (`startOverride`).
   */
  next(numId: string, ilvl: number): { text: string; suffix: Level["suffix"]; run: RunPatch; isBullet: boolean } | null {
    const inst = this.nums.get(numId);
    if (!inst || numId === "0") return null;
    const level = this.level(numId, ilvl);
    if (!level) return null;
    const restartsHere = [...inst.overrides.values()].some((o) => o.start !== null);
    const key = restartsHere ? `n${numId}` : `a${inst.abstractId}`;
    let counters = this.counters.get(key);
    if (!counters) {
      counters = Array.from({ length: 9 }, (_, i) => {
        const l = this.level(numId, i);
        const override = inst.overrides.get(i)?.start;
        return (override ?? l?.start ?? 1) - 1;
      });
      this.counters.set(key, counters);
    }
    counters[ilvl] += 1;
    // Os níveis abaixo recomeçam quando um nível acima avança.
    for (let deeper = ilvl + 1; deeper < 9; deeper++) {
      const l = this.level(numId, deeper);
      const restartAt = l?.restart ?? null;
      if (restartAt === 0) continue;
      if (restartAt === null || restartAt - 1 <= ilvl) {
        const override = inst.overrides.get(deeper)?.start;
        counters[deeper] = (override ?? l?.start ?? 1) - 1;
      }
    }

    if (level.format === "bullet") {
      return { text: bulletText(level.text), suffix: level.suffix, run: level.run, isBullet: true };
    }
    const text = level.text.replace(/%([1-9])/g, (_, d: string) => {
      const i = Number(d) - 1;
      const l = this.level(numId, i);
      const format = level.legal ? "decimal" : (l?.format ?? "decimal");
      return formatNumber(Math.max(counters![i], l?.start ?? 1), format);
    });
    return { text, suffix: level.suffix, run: level.run, isBullet: false };
  }
}
