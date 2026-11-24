import * as pdfLib from "@cantoo/pdf-lib";
import { PDFDocument, EncryptedPDFError, degrees } from "@cantoo/pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { Document, Packer, Paragraph, TextRun, PageBreak } from "docx";
import { parsePageRange } from "../../src/lib/page-range.js";
import { dropUnreachableObjects } from "../../src/lib/pdf-cleanup.js";
import { escapeHtml } from "./telegram.js";

export { parsePageRange };

/**
 * Abre o PDF, inclusive o protegido só por senha de proprietário — o caso de
 * extrato de banco e documento de órgão público, que qualquer leitor abre sem
 * pedir nada. O de senha de abertura não tem como ser aberto pelo bot, que não
 * conversa para pedir a senha; aí a mensagem diz o que fazer.
 */
async function abrirPdf(bytes: Uint8Array, opcoes: { updateMetadata?: boolean } = {}): Promise<PDFDocument> {
  // Descarta as sobras do parser (XRef stream, ObjStm, o dicionário de
  // criptografia): regravadas, faziam o PDF criptografado de origem sair
  // ainda marcado como criptografado. Mesma limpeza do site, em pdf-unlock.
  const limpo = (doc: PDFDocument) => {
    dropUnreachableObjects(pdfLib, doc);
    return doc;
  };
  try {
    return limpo(await PDFDocument.load(bytes, opcoes));
  } catch (err) {
    if (!(err instanceof EncryptedPDFError)) throw err;
  }
  try {
    return limpo(await PDFDocument.load(bytes, { ...opcoes, password: "" }));
  } catch (err) {
    if (err instanceof Error && err.message === "NEEDS PASSWORD") {
      throw new Error("Este PDF pede senha para abrir. Remova a senha no site e envie de novo.");
    }
    throw err;
  }
}

export async function splitPdf(bytes: Uint8Array, range: string): Promise<Uint8Array> {
  const origem = await abrirPdf(bytes);
  const destino = await PDFDocument.create();
  const copiadas = await destino.copyPages(origem, parsePageRange(range, origem.getPageCount()));
  copiadas.forEach((p) => destino.addPage(p));
  return destino.save();
}

export async function rotatePdf(bytes: Uint8Array, graus = 90): Promise<Uint8Array> {
  const doc = await abrirPdf(bytes);
  for (const p of doc.getPages()) p.setRotation(degrees((p.getRotation().angle + graus) % 360));
  return doc.save();
}

export async function pdfInfo(bytes: Uint8Array): Promise<string> {
  const doc = await abrirPdf(bytes, { updateMetadata: false });
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
