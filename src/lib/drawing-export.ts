import { saveAs } from "file-saver";
import type { Canvas } from "fabric";

export function toPng(canvas: Canvas, filename = "desenho.png") {
  const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
  saveAs(dataURLtoBlob(dataUrl), filename);
}

export function toJpg(canvas: Canvas, quality = 0.92, filename = "desenho.jpg") {
  const dataUrl = canvas.toDataURL({ format: "jpeg", quality, multiplier: 1 });
  saveAs(dataURLtoBlob(dataUrl), filename);
}

export function toSvg(canvas: Canvas, filename = "desenho.svg") {
  const svg = canvas.toSVG();
  saveAs(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export function toJson(canvas: Canvas, filename = "desenho.fabric.json") {
  const json = JSON.stringify(canvas.toJSON());
  saveAs(new Blob([json], { type: "application/json;charset=utf-8" }), filename);
}

function dataURLtoBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}