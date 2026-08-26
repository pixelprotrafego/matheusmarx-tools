import { PDFDocument, degrees } from "npm:pdf-lib@1.17.1";

export function parsePageRange(input: string, total: number): number[] {
  // Aceita: "1-3,5,8-10". Retorna índices 0-based, sem duplicar, em ordem.
  const out = new Set<number>();
  for (const part of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= total) out.add(n - 1);
    } else {
      throw new Error(`Range inválido: "${part}"`);
    }
  }
  if (out.size === 0) throw new Error("Nenhuma página válida no range.");
  return [...out].sort((a, b) => a - b);
}

export async function splitPdf(bytes: Uint8Array, range: string): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes);
  const indices = parsePageRange(range, src.getPageCount());
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  return await out.save();
}

export async function rotatePdf(bytes: Uint8Array, deg = 90): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  for (const p of doc.getPages()) {
    const cur = p.getRotation().angle;
    p.setRotation(degrees((cur + deg) % 360));
  }
  return await doc.save();
}

export async function pdfInfo(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPageCount();
  const title = doc.getTitle() || "—";
  const author = doc.getAuthor() || "—";
  const subject = doc.getSubject() || "—";
  const creator = doc.getCreator() || "—";
  const sizeKb = (bytes.byteLength / 1024).toFixed(1);
  const first = doc.getPage(0);
  const { width, height } = first.getSize();
  return [
    `📊 <b>Info do PDF</b>`,
    `Páginas: <b>${pages}</b>`,
    `Tamanho: <b>${sizeKb} KB</b>`,
    `Dimensão pg.1: <b>${Math.round(width)} × ${Math.round(height)} pt</b>`,
    `Título: ${escapeHtml(title)}`,
    `Autor: ${escapeHtml(author)}`,
    `Assunto: ${escapeHtml(subject)}`,
    `Criador: ${escapeHtml(creator)}`,
  ].join("\n");
}

export async function pdfToDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [String(text)];

  const { Document, Packer, Paragraph, TextRun, HeadingLevel, PageBreak } = await import("npm:docx@9.0.3");
  const children: unknown[] = [];
  pages.forEach((pageText, i) => {
    if (i > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `Página ${i + 1}`, bold: true })],
    }));
    for (const line of (pageText || "").split(/\r?\n/)) {
      children.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  });
  // deno-lint-ignore no-explicit-any
  const doc = new Document({ sections: [{ children: children as any }] });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}