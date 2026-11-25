import { fileToImage, drawToCanvas, canvasToBlob } from "./canvas-utils";

/** Pixels CSS (96 por polegada) por unidade de medida do SVG. */
const UNIT_PX: Record<string, number> = { "": 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };

/** Comprimento do SVG em pixels CSS; `null` para porcentagem ou valor inválido. */
export function svgLength(value: string | null): number | null {
  if (!value) return null;
  const m = /^\s*([\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
  if (!m) return null;
  const unit = m[2].toLowerCase();
  if (unit === "%" || !(unit in UNIT_PX)) return null;
  const n = Number(m[1]) * UNIT_PX[unit];
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Tamanho de exibição do SVG, em pixels CSS. Largura e altura em mm, cm, pol.
 * ou pt valem pela medida (antes "210mm" virava 210 px); porcentagem cai para
 * a caixa de visão (viewBox), com a proporção dela.
 */
export function parseSvgDimensions(svgText: string): { width: number; height: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  let w = svgLength(svg.getAttribute("width"));
  let h = svgLength(svg.getAttribute("height"));
  const vb = (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  if (hasVb) {
    if (!w && !h) {
      w = vb[2];
      h = vb[3];
    } else if (!w) w = (h! * vb[2]) / vb[3];
    else if (!h) h = (w * vb[3]) / vb[2];
  }
  return { width: w || 800, height: h || 600 };
}

export async function rasterizeSvg(
  file: File,
  scale = 2,
  type: "image/png" | "image/jpeg" | "image/webp" = "image/png",
  quality?: number
): Promise<{ blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }> {
  const text = await file.text();
  const { width, height } = parseSvgDimensions(text);
  const blob = new Blob([text], { type: "image/svg+xml" });
  const img = await fileToImage(blob);
  const canvas = drawToCanvas(img, Math.round(width * scale), Math.round(height * scale), type === "image/jpeg" ? "#ffffff" : undefined);
  const out = await canvasToBlob(canvas, type, quality);
  return { blob: out, width, height, canvas };
}

/**
 * Por que este SVG não pode ir vetorial para o PDF, ou `null` se pode.
 * Filtros (desfoque, sombra), HTML embutido e imagem de fora não têm
 * equivalente no desenho vetorial: nesses casos vale a imagem em alta
 * resolução, que mostra exatamente o que o navegador mostra.
 */
export function rasterReason(svgText: string): string | null {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (doc.getElementsByTagName("parsererror").length) return "svg inválido";
  const all = Array.from(doc.getElementsByTagName("*"));
  if (all.some((e) => e.localName === "filter" || e.hasAttribute("filter"))) return "filtro";
  if (all.some((e) => e.localName === "foreignObject")) return "html embutido";
  if (all.some((e) => e.localName === "image" && /^https?:/i.test(e.getAttribute("href") ?? e.getAttribute("xlink:href") ?? ""))) return "imagem externa";
  if (/@import|@font-face|filter\s*:/i.test(svgText)) return "estilo que o vetorial não segue";
  return null;
}
