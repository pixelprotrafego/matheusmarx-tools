import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { Buffer } from "node:buffer";

type Fmt = "png" | "jpeg" | "webp";

export function detectFormat(mime: string, filename: string): Fmt | null {
  const m = (mime || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  if (m.includes("png") || n.endsWith(".png")) return "png";
  if (m.includes("webp") || n.endsWith(".webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg") || /\.jpe?g$/.test(n)) return "jpeg";
  return null;
}

async function loadJimp(bytes: Uint8Array) {
  const mod = await import("npm:jimp@0.22.12");
  // deno-lint-ignore no-explicit-any
  const Jimp: any = (mod as any).default ?? mod;
  return await Jimp.read(Buffer.from(bytes));
}

export async function convertImage(bytes: Uint8Array, target: Fmt): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  const img = await loadJimp(bytes);
  const mime = target === "png" ? "image/png" : target === "webp" ? "image/webp" : "image/jpeg";
  // jimp 0.22 não tem webp nativo: fallback para png se webp pedido.
  const realMime = target === "webp" ? "image/png" : mime;
  const realExt = target === "webp" ? "png" : target === "jpeg" ? "jpg" : "png";
  const buf: Uint8Array = await img.getBufferAsync(realMime);
  return { bytes: new Uint8Array(buf), mime: realMime, ext: realExt };
}

export async function resizeImage(bytes: Uint8Array, width: number, mime: string): Promise<Uint8Array> {
  if (!Number.isFinite(width) || width < 16 || width > 8000) throw new Error("Largura entre 16 e 8000.");
  const img = await loadJimp(bytes);
  const Jimp = (await import("npm:jimp@0.22.12")) as any;
  img.resize(width, Jimp.default?.AUTO ?? Jimp.AUTO);
  const outMime = (mime || "").includes("png") ? "image/png" : "image/jpeg";
  const buf: Uint8Array = await img.getBufferAsync(outMime);
  return new Uint8Array(buf);
}

export async function imageToPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const m = (mime || "").toLowerCase();
  let img;
  if (m.includes("png")) img = await doc.embedPng(bytes);
  else if (m.includes("jpeg") || m.includes("jpg")) img = await doc.embedJpg(bytes);
  else {
    // converte para PNG via jimp
    const conv = await convertImage(bytes, "png");
    img = await doc.embedPng(conv.bytes);
  }
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return await doc.save();
}