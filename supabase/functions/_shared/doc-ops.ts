import { Buffer } from "node:buffer";

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("npm:mammoth@1.8.0");
  // deno-lint-ignore no-explicit-any
  const m: any = (mammoth as any).default ?? mammoth;
  const { value } = await m.extractRawText({ buffer: Buffer.from(bytes) });
  return (value || "").trim();
}

export async function xlsxToText(bytes: Uint8Array): Promise<string> {
  const XLSX = await import("npm:xlsx@0.18.5");
  // deno-lint-ignore no-explicit-any
  const x: any = (XLSX as any).default ?? XLSX;
  const wb = x.read(bytes, { type: "array" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = x.utils.sheet_to_csv(wb.Sheets[name]);
    parts.push(`### ${name}\n${csv}`);
  }
  return parts.join("\n\n").trim();
}