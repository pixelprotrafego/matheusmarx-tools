import { saveAs } from "file-saver";
import JSZip from "jszip";

export function downloadBlob(blob: Blob, filename: string) {
  saveAs(blob, filename);
}

export async function downloadAsZip(
  files: { name: string; blob: Blob }[],
  zipName: string
) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  const out = await zip.generateAsync({ type: "blob" });
  saveAs(out, zipName);
}

export function replaceExt(name: string, newExt: string): string {
  return name.replace(/\.[^.]+$/, "") + "." + newExt.replace(/^\./, "");
}

export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  // Workaround for TS narrowing of ArrayBufferLike vs ArrayBuffer.
  const buf = bytes.slice().buffer;
  return new Blob([buf], { type });
}