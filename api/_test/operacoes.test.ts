// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { convertImage, imageToPdf, resizeImage } from "../_lib/image-ops.js";
import { parsePageRange, pdfToDocx, pdfToText, rotatePdf } from "../_lib/pdf-ops.js";
import { docxToText, xlsxToText } from "../_lib/doc-ops.js";

/** PNG 120 × 60 gerado na hora, para o teste não depender de arquivo no disco. */
async function pngDeTeste(): Promise<Uint8Array> {
  const img = new Jimp({ width: 120, height: 60, color: 0x5828a0ff });
  return new Uint8Array(await img.getBuffer("image/png"));
}

async function pdfComTexto(paginas: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const texto of paginas) doc.addPage([400, 200]).drawText(texto, { x: 20, y: 150, size: 14, font: fonte });
  return doc.save();
}

describe("imagens", () => {
  it("converte PNG para JPEG de verdade", async () => {
    const r = await convertImage(await pngDeTeste(), "jpeg");
    expect(r).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
    expect([...r.bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("pedido de WebP sai em PNG, sem perda", async () => {
    const r = await convertImage(await pngDeTeste(), "webp");
    expect(r.mime).toBe("image/png");
  });

  it("redimensiona mantendo a proporção", async () => {
    const saida = await Jimp.read(Buffer.from(await resizeImage(await pngDeTeste(), 60, "image/png")));
    expect([saida.width, saida.height]).toEqual([60, 30]);
  });

  it("recusa largura fora do intervalo", async () => {
    await expect(resizeImage(await pngDeTeste(), 5, "image/png")).rejects.toThrow(/16 e 8000/);
  });

  it("imagem vira PDF de uma página do tamanho exato dela", async () => {
    const pdf = await PDFDocument.load(await imageToPdf(await pngDeTeste(), "image/png"));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 120, height: 60 });
  });
});

describe("PDF", () => {
  it("interpreta intervalos de página", () => {
    expect(parsePageRange("3-1, 5, 5, 9", 6)).toEqual([0, 1, 2, 4]);
    expect(() => parsePageRange("abc", 6)).toThrow(/Range inválido/);
    expect(() => parsePageRange("10-12", 6)).toThrow(/Nenhuma página/);
  });

  it("gira todas as páginas somando à rotação que já existia", async () => {
    const doc = await PDFDocument.load(await rotatePdf(await pdfComTexto(["a", "b"]), 90));
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90]);
  });

  it("extrai o texto", async () => {
    expect(await pdfToText(await pdfComTexto(["Contrato de prestacao"]))).toContain("Contrato de prestacao");
  });

  it("PDF → Word traz o texto de cada página, sem inventar título que não existe no original", async () => {
    const docx = await pdfToDocx(await pdfComTexto(["Primeira folha", "Segunda folha"]));
    const xml = await (await JSZip.loadAsync(docx)).file("word/document.xml")!.async("string");
    expect(xml).toContain("Primeira folha");
    expect(xml).toContain("Segunda folha");
    expect(xml).toContain('w:type="page"');
    expect(xml).not.toMatch(/Página \d/);
  });
});

describe("documentos de escritório", () => {
  it("extrai o texto de um DOCX", async () => {
    const doc = new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun("Cláusula primeira")] })] }] });
    expect(await docxToText(new Uint8Array(await Packer.toBuffer(doc)))).toBe("Cláusula primeira");
  });

  it("transforma cada aba de uma planilha num bloco CSV", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Município", "Total"], ["Belém", 10]]), "Vendas");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    expect(xlsxToText(bytes)).toBe("### Vendas\nMunicípio,Total\nBelém,10");
  });
});
