import { fileToImage, drawToCanvas, canvasToBlob } from "./canvas-utils";

export function parseSvgDimensions(svgText: string): { width: number; height: number } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  let w = parseFloat(svg.getAttribute("width") || "");
  let h = parseFloat(svg.getAttribute("height") || "");
  if (!w || !h) {
    const vb = svg.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      if (parts.length === 4) {
        w = w || parts[2];
        h = h || parts[3];
      }
    }
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
  const canvas = drawToCanvas(img, width * scale, height * scale, type === "image/jpeg" ? "#ffffff" : undefined);
  const out = await canvasToBlob(canvas, type, quality);
  return { blob: out, width, height, canvas };
}