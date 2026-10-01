import { PDFDocument, degrees } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { Document, Packer, Paragraph, TextRun, PageBreak } from "docx";
import { escapeHtml } from "./telegram.js";

/** "1-3,5,8-10" → índices 0-based, sem repetição, em ordem. */
export function parsePageRange(input: string, total: number): number[] {
  const paginas = new Set<number>();
  for (const parte of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const faixa = parte.match(/^(\d+)\s*-\s*(\d+)$/);
    if (faixa) {
      let a = parseInt(faixa[1], 10);
      let b = parseInt(faixa[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) paginas.add(i - 1);
    } else if (/^\d+$/.test(parte)) {
      const n = parseInt(parte, 10);
      if (n >= 1 && n <= total) paginas.add(n - 1);
    } else {
      throw new Error(`Range inválido: "${parte}"`);
    }
  }
  if (paginas.size === 0) throw new Error("Nenhuma página válida no range.");
  return [...paginas].sort((a, b) => a - b);
}

export async function splitPdf(bytes: Uint8Array, range: string): Promise<Uint8Array> {
  const origem = await PDFDocument.load(bytes);
  const destino = await PDFDocument.create();
  const copiadas = await destino.copyPages(origem, parsePageRange(range, origem.getPageCount()));
  copiadas.forEach((p) => destino.addPage(p));
  return destino.save();
}

export async function rotatePdf(bytes: Uint8Array, graus = 90): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  for (const p of doc.getPages()) p.setRotation(degrees((p.getRotation().angle + graus) % 360));
  return doc.save();
}

export async function pdfInfo(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { width, height } = doc.getPage(0).getSize();
  return [
    `📊 <b>Info do PDF</b>`,
    `Páginas: <b>${doc.getPageCount()}</b>`,
    `Tamanho: <b>${(bytes.byteLength / 1024).toFixed(1)} KB</b>`,
    `Dimensão pg.1: <b>${Math.round(width)} × ${Math.round(height)} pt</b>`,
    `Título: ${escapeHtml(doc.getTitle() || "—")}`,
    `Autor: ${escapeHtml(doc.getAuthor() || "—")}`,
    `Assunto: ${escapeHtml(doc.getSubject() || "—")}`,
    `Criador: ${escapeHtml(doc.getCreator() || "—")}`,
  ].join("\n");
}

/** Texto corrido do PDF inteiro. */
export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.trim();
}

/**
 * PDF → Word para o bot: o texto de cada página, uma página do Word por página
 * do PDF.
 *
 * A versão anterior abria cada página com um título "Página N" que não existe
 * no PDF — exatamente o defeito que fez o conversor do site ser refeito do
 * zero. Aqui ele saiu: o documento traz só o que está no original. O conversor
 * fiel, com fontes, tabelas e imagens, roda no navegador (src/lib/pdf-to-docx)
 * e depende de canvas; no bot fica a extração de texto.
 */
export async function pdfToDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });

  const filhos: Paragraph[] = [];
  text.forEach((pagina, i) => {
    if (i > 0) filhos.push(new Paragraph({ children: [new PageBreak()] }));
    for (const linha of (pagina || "").split(/\r?\n/)) {
      filhos.push(new Paragraph({ children: [new TextRun(linha)] }));
    }
  });

  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: filhos }] }));
  return new Uint8Array(buffer);
}
