/**
 * SVG para PDF, vetorial.
 *
 * O SVG vira desenho vetorial no PDF (pelo svg2pdf.js): nítido em qualquer
 * ampliação, com texto selecionável, como o original. Antes ele era fotografado
 * a 3x, e o PDF saía com uma imagem. O SVG que usa algo sem equivalente
 * vetorial (filtro, HTML embutido, imagem de fora) vai como imagem em alta
 * resolução — a que mostra exatamente o que o navegador mostra.
 */

import type { jsPDF as JsPdf } from "jspdf";
import { parseSvgDimensions, rasterReason } from "./svg-utils";

export interface SvgToPdfOptions {
  pageSize: "fit" | "a4" | "letter";
  orientation: "portrait" | "landscape";
}

/** Pixel CSS (1/96 pol.) em pontos. O documento fica em pontos, a unidade do
 * PDF: em milímetros, o jsPDF errava a escala dos padrões de preenchimento. */
const PX_TO_PT = 0.75;

const SHAPES = new Set(["rect", "circle", "ellipse", "path", "polygon", "polyline", "line"]);

/**
 * Forma com preenchimento em gradiente ou padrão e contorno: o svg2pdf pinta
 * o preenchimento depois do contorno, que fica com metade da espessura (medido
 * num círculo de contorno 3, que saía com 1,5). Uma cópia só com o contorno,
 * desenhada depois, devolve a espessura certa.
 */
function separateGradientStrokes(root: Element): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (!SHAPES.has(el.localName)) continue;
    const style = getComputedStyle(el);
    const fill = style.fill || el.getAttribute("fill") || "";
    const stroke = style.stroke || el.getAttribute("stroke") || "none";
    if (!/url\(/.test(fill) || stroke === "none") continue;
    const outline = el.cloneNode(true) as SVGElement;
    outline.removeAttribute("id");
    outline.setAttribute("fill", "none");
    outline.style.fill = "none";
    (el as SVGElement).setAttribute("stroke", "none");
    (el as SVGElement).style.stroke = "none";
    el.after(outline);
  }
}

export async function svgToPdf(text: string, options: SvgToPdfOptions): Promise<{ blob: Blob; vector: boolean }> {
  const { default: jsPDF } = await import("jspdf");
  const { width, height } = parseSvgDimensions(text);
  const ratio = width / height;

  let pdf: JsPdf;
  let x = 0;
  let y = 0;
  let drawW: number;
  let drawH: number;
  if (options.pageSize === "fit") {
    // Página do tamanho do SVG, limitada a 600 mm no lado maior.
    const maxPt = (600 / 25.4) * 72;
    drawW = width * PX_TO_PT;
    drawH = height * PX_TO_PT;
    if (drawW > maxPt || drawH > maxPt) {
      const s = maxPt / Math.max(drawW, drawH);
      drawW *= s;
      drawH *= s;
    }
    pdf = new jsPDF({ orientation: ratio >= 1 ? "landscape" : "portrait", unit: "pt", format: [drawW, drawH] });
  } else {
    pdf = new jsPDF({ orientation: options.orientation, unit: "pt", format: options.pageSize });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = (10 / 25.4) * 72; // 10 mm
    drawW = pageW - margin * 2;
    drawH = drawW / ratio;
    if (drawH > pageH - margin * 2) {
      drawH = pageH - margin * 2;
      drawW = drawH * ratio;
    }
    x = (pageW - drawW) / 2;
    y = (pageH - drawH) / 2;
  }

  const reason = rasterReason(text);
  if (!reason) {
    try {
      // A função, e não o método `pdf.svg`: o jsPDF copia os plugins para o
      // documento quando ele é criado, e este foi criado antes do carregamento.
      const { svg2pdf } = await import("svg2pdf.js");
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      // Montado (fora da tela) para os estilos calculados valerem.
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden;";
      const root = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
      // Sem caixa de visão, o svg2pdf toma cada unidade do SVG como unidade do
      // PDF (milímetro) e amplia o desenho: a caixa é a do tamanho do SVG.
      if (!root.getAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
      host.appendChild(root);
      document.body.appendChild(host);
      separateGradientStrokes(root);
      try {
        await svg2pdf(host.firstElementChild!, pdf, { x, y, width: drawW, height: drawH });
      } finally {
        host.remove();
      }
      return { blob: pdf.output("blob"), vector: true };
    } catch (err) {
      // SVG que o desenho vetorial não entende: segue pela imagem.
      console.warn("SVG para PDF: vetorial falhou, indo como imagem.", err);
    }
  }

  // Imagem a cerca de 300 dpi do tamanho na página (no máximo 8000 px).
  const targetPx = Math.min(8000, (Math.max(drawW, drawH) / 72) * 300);
  const scale = targetPx / Math.max(width, height);
  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, drawW, drawH, undefined, "FAST");
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    throw new Error("Não foi possível ler este SVG.");
  } finally {
    URL.revokeObjectURL(url);
  }
  return { blob: pdf.output("blob"), vector: false };
}
