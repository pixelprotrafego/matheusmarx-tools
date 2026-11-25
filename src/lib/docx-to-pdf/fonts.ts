/**
 * Fontes do documento.
 *
 * O PDF só pode levar texto de verdade com a fonte embutida, e só dá para
 * embutir a fonte que se tem em mãos. As fontes do Office (Calibri, Arial,
 * Times New Roman…) não podem ser distribuídas, mas existem equivalentes
 * livres com exatamente as mesmas larguras de letra: Carlito, Liberation e
 * Caladea. Com elas, cada linha quebra no mesmo ponto em que o Word quebra —
 * em qualquer computador ou celular, tenha ele o Office instalado ou não.
 *
 * O mesmo arquivo serve para o navegador montar a página (FontFace) e para o
 * PDF (embutido como subconjunto): a medida usada para quebrar a linha é a
 * mesma do desenho final, e nada sai deslocado.
 */

export type FontKey = "carlito" | "caladea" | "liberation-sans" | "liberation-serif" | "liberation-mono";

const MAP: Record<string, FontKey> = {
  calibri: "carlito", "calibri light": "carlito", carlito: "carlito", candara: "carlito", corbel: "carlito",
  cambria: "caladea", "cambria math": "caladea", caladea: "caladea", constantia: "caladea",
  arial: "liberation-sans", helvetica: "liberation-sans", "arial nova": "liberation-sans", "arial narrow": "liberation-sans",
  // Aptos Narrow (padrão do Excel novo) tem dígitos de 0,513 em; a Carlito, de
  // 0,507 em: é a equivalente mais próxima entre as fontes do pacote.
  aptos: "liberation-sans", "aptos display": "liberation-sans", "aptos narrow": "carlito",
  "segoe ui": "liberation-sans", "segoe ui light": "liberation-sans", verdana: "liberation-sans", tahoma: "liberation-sans",
  "trebuchet ms": "liberation-sans", "century gothic": "liberation-sans", "franklin gothic book": "liberation-sans",
  "gill sans mt": "liberation-sans", "lucida sans": "liberation-sans", "lucida sans unicode": "liberation-sans",
  roboto: "liberation-sans", "open sans": "liberation-sans", montserrat: "liberation-sans", lato: "liberation-sans",
  "liberation sans": "liberation-sans", arimo: "liberation-sans",
  "times new roman": "liberation-serif", times: "liberation-serif", "liberation serif": "liberation-serif", tinos: "liberation-serif",
  georgia: "liberation-serif", garamond: "liberation-serif", "book antiqua": "liberation-serif", "palatino linotype": "liberation-serif",
  palatino: "liberation-serif", "bookman old style": "liberation-serif", "century schoolbook": "liberation-serif",
  "century": "liberation-serif", "baskerville old face": "liberation-serif",
  "courier new": "liberation-mono", courier: "liberation-mono", consolas: "liberation-mono", "lucida console": "liberation-mono",
  "liberation mono": "liberation-mono", cousine: "liberation-mono",
};

/** Fonte equivalente para o nome que o documento usa. */
export function fontKeyFor(name: string): FontKey {
  const n = name.trim().toLowerCase();
  if (MAP[n]) return MAP[n];
  if (/mono|courier|consol|code/.test(n)) return "liberation-mono";
  if (/serif|roman|times|georgia|garamond|book|antiqua|bodoni|didot|cambria/.test(n) && !/sans/.test(n)) return "liberation-serif";
  return "liberation-sans";
}

export const SYMBOLS_FAMILY = "docx-symbols";

export const cssFamily = (key: FontKey) => `"docx-${key}", "${SYMBOLS_FAMILY}"`;

interface Metrics {
  unitsPerEm: number;
  /** Altura de linha "simples" do Word, em em. */
  lineFactor: number;
  /** Da linha de base para cima e para baixo, como o Word divide a linha, em em. */
  ascent: number;
  descent: number;
}

/**
 * Métricas verticais da fonte do Office que a equivalente substitui, quando
 * elas diferem: a Caladea tem as larguras da Cambria, mas não a altura de
 * linha (1,30 em contra 1,17 em da Cambria).
 */
const OFFICE_METRICS: Partial<Record<FontKey, { ascent: number; descent: number }>> = {
  caladea: { ascent: 1946 / 2048, descent: 455 / 2048 },
};

function tableOffsets(view: DataView): Map<string, number> {
  const numTables = view.getUint16(4);
  const tables = new Map<string, number>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));
    tables.set(tag, view.getUint32(rec + 8));
  }
  return tables;
}

/**
 * Lê o mínimo do OpenType: unidades por em e a linha simples do Word.
 *
 * O Word mede a linha simples pelas métricas do Windows (`usWinAscent` e
 * `usWinDescent`) mais o "line gap" da tabela `hhea`: 1,2207 em na Calibri,
 * 1,15 em na Arial e na Times New Roman. O "line gap" fica acima do texto
 * (medido no Word, num documento de teste), e a linha de base, a
 * `usWinAscent` + "line gap" do alto da linha.
 */
export function readMetrics(buffer: ArrayBuffer, key?: FontKey | "symbols"): Metrics {
  const view = new DataView(buffer);
  const tables = tableOffsets(view);
  const head = tables.get("head") ?? 0;
  const hhea = tables.get("hhea") ?? 0;
  const os2 = tables.get("OS/2");
  const unitsPerEm = view.getUint16(head + 18) || 1000;
  const hheaAscent = view.getInt16(hhea + 4);
  const hheaDescent = view.getInt16(hhea + 6);
  const lineGap = view.getInt16(hhea + 8);
  const winAscent = os2 !== undefined ? view.getUint16(os2 + 74) : hheaAscent;
  const winDescent = os2 !== undefined ? view.getUint16(os2 + 76) : -hheaDescent;
  const office = key && key !== "symbols" ? OFFICE_METRICS[key] : undefined;
  const ascent = office?.ascent ?? (winAscent + Math.max(0, lineGap)) / unitsPerEm;
  const descent = office?.descent ?? winDescent / unitsPerEm;
  return { unitsPerEm, lineFactor: ascent + descent, ascent, descent };
}

/**
 * Cópia da fonte com as métricas verticais iguais às do Word, para o navegador
 * montar a página.
 *
 * Cada sistema escolhe uma das três tabelas de métricas da fonte (`hhea`,
 * `OS/2` tipográfica ou `OS/2` do Windows) para decidir onde fica a linha de
 * base. Com as três iguais à divisão do Word, a linha de base cai no mesmo
 * lugar em qualquer computador, e a caixa de cada trecho tem exatamente a
 * altura da linha simples do Word. O PDF recebe a fonte original.
 */
export function wordMetricsCopy(buffer: ArrayBuffer, metrics: Metrics): ArrayBuffer {
  const copy = buffer.slice(0);
  const view = new DataView(copy);
  const tables = tableOffsets(view);
  const hhea = tables.get("hhea");
  const os2 = tables.get("OS/2");
  const a = Math.round(metrics.ascent * metrics.unitsPerEm);
  const d = Math.round(metrics.descent * metrics.unitsPerEm);
  if (hhea !== undefined) {
    view.setInt16(hhea + 4, a);
    view.setInt16(hhea + 6, -d);
    view.setInt16(hhea + 8, 0);
  }
  if (os2 !== undefined) {
    view.setInt16(os2 + 68, a);
    view.setInt16(os2 + 70, -d);
    view.setInt16(os2 + 72, 0);
    view.setUint16(os2 + 74, a);
    view.setUint16(os2 + 76, d);
    // USE_TYPO_METRICS: quem respeita a tabela tipográfica usa os mesmos valores.
    view.setUint16(os2 + 62, view.getUint16(os2 + 62) | 0x80);
  }
  return copy;
}

export interface LoadedFont {
  key: FontKey | "symbols";
  bold: boolean;
  italic: boolean;
  bytes: ArrayBuffer;
  metrics: Metrics;
}

const fileName = (key: FontKey | "symbols", bold: boolean, italic: boolean) =>
  key === "symbols" ? "dejavu-symbols.ttf" : `${key}-${bold ? 700 : 400}${italic ? "i" : ""}.ttf`;

/** Carrega e registra as fontes usadas; guarda os bytes para o PDF. */
export class FontManager {
  private readonly loaded = new Map<string, LoadedFont>();
  private readonly pending = new Map<string, Promise<LoadedFont>>();

  constructor(private readonly baseUrl = "/fonts/docx/") {}

  private id(key: FontKey | "symbols", bold: boolean, italic: boolean) {
    return `${key}|${bold}|${italic}`;
  }

  async load(key: FontKey | "symbols", bold: boolean, italic: boolean): Promise<LoadedFont> {
    if (key === "symbols") {
      bold = false;
      italic = false;
    }
    const id = this.id(key, bold, italic);
    const ready = this.loaded.get(id);
    if (ready) return ready;
    let promise = this.pending.get(id);
    if (!promise) {
      promise = (async () => {
        const response = await fetch(this.baseUrl + fileName(key, bold, italic));
        if (!response.ok) throw new Error(`Não foi possível carregar a fonte ${fileName(key, bold, italic)}.`);
        const bytes = await response.arrayBuffer();
        const family = key === "symbols" ? SYMBOLS_FAMILY : `docx-${key}`;
        const metrics = readMetrics(bytes, key);
        const face = new FontFace(family, wordMetricsCopy(bytes, metrics), {
          weight: bold ? "700" : "400",
          style: italic ? "italic" : "normal",
        });
        await face.load();
        document.fonts.add(face);
        const font: LoadedFont = { key, bold, italic, bytes, metrics };
        this.loaded.set(id, font);
        return font;
      })();
      this.pending.set(id, promise);
    }
    return promise;
  }

  get(key: FontKey | "symbols", bold: boolean, italic: boolean): LoadedFont | undefined {
    if (key === "symbols") return this.loaded.get(this.id("symbols", false, false));
    return this.loaded.get(this.id(key, bold, italic)) ?? this.loaded.get(this.id(key, false, false));
  }

  /** Altura de linha simples do Word para a fonte e o corpo, em pontos. */
  lineHeight(key: FontKey, size: number, bold = false, italic = false): number {
    const f = this.get(key, bold, italic);
    return (f?.metrics.lineFactor ?? 1.2) * size;
  }

  private readonly spaces = new Map<string, number>();
  private measureContext: CanvasRenderingContext2D | null = null;

  /** Largura do espaço da fonte, em em (medida na fonte já registrada). */
  spaceEm(key: FontKey, bold = false, italic = false): number {
    const id = this.id(key, bold, italic);
    const cached = this.spaces.get(id);
    if (cached !== undefined) return cached;
    this.measureContext ??= document.createElement("canvas").getContext("2d");
    let em = 0.25;
    if (this.measureContext) {
      this.measureContext.font = `${italic ? "italic " : ""}${bold ? 700 : 400} 100px "docx-${key}"`;
      em = this.measureContext.measureText(" ").width / 100 || 0.25;
    }
    this.spaces.set(id, em);
    return em;
  }

  /** Da linha de base ao alto da linha simples do Word, em pontos. */
  ascent(key: FontKey, size: number, bold = false, italic = false): number {
    const f = this.get(key, bold, italic);
    return (f?.metrics.ascent ?? 0.9) * size;
  }

  all(): LoadedFont[] {
    return [...this.loaded.values()];
  }
}
