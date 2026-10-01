import mammoth from "mammoth";
import * as XLSX from "xlsx";

export async function docxToText(bytes: Uint8Array): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return (value || "").trim();
}

/** Cada aba vira um bloco CSV com o nome dela como título. */
export function xlsxToText(bytes: Uint8Array): string {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((nome) => `### ${nome}\n${XLSX.utils.sheet_to_csv(wb.Sheets[nome])}`)
    .join("\n\n")
    .trim();
}
