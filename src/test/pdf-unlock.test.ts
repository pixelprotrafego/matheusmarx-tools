// @vitest-environment node
import { describe, it, expect } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "@cantoo/pdf-lib";
import { openPdf, PdfPasswordError } from "@/lib/pdf-unlock";

const TEXTOS = ["PAGINA UM", "PAGINA DOIS"];

async function pdfBase(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const t of TEXTOS) doc.addPage([300, 200]).drawText(t, { x: 20, y: 100, size: 14, font: fonte });
  return doc;
}

async function protegido(senhas: { ownerPassword: string; userPassword?: string }): Promise<Uint8Array> {
  const doc = await pdfBase();
  doc.encrypt({ ...senhas, permissions: { modifying: false, copying: false } });
  return doc.save();
}

/** Bytes brutos do conteúdo de cada página: iguais só se a descriptografia foi exata. */
function conteudo(doc: PDFDocument): string[] {
  return doc.getPages().map((p) => {
    let s = doc.context.lookup(p.node.get(PDFName.of("Contents")));
    if (s instanceof PDFArray) s = doc.context.lookup(s.get(0));
    return Buffer.from((s as PDFRawStream).getContents()).toString("hex");
  });
}

describe("openPdf", () => {
  it("abre PDF comum sem marcar como criptografado", async () => {
    const { doc, encrypted } = await openPdf(await (await pdfBase()).save());
    expect(encrypted).toBe(false);
    expect(doc.getPageCount()).toBe(2);
  });

  it("desbloqueia sozinho o PDF que só tem senha de proprietário, com o conteúdo intacto", async () => {
    const original = await PDFDocument.load(await (await pdfBase()).save());
    const { doc, encrypted } = await openPdf(await protegido({ ownerPassword: "dono" }));
    expect(encrypted).toBe(true);
    expect(conteudo(doc)).toEqual(conteudo(original));
  });

  it("pede a senha quando o PDF tem senha de abertura", async () => {
    const bytes = await protegido({ ownerPassword: "dono", userPassword: "segredo" });
    await expect(openPdf(bytes)).rejects.toMatchObject({ name: "PdfPasswordError", reason: "required" });
    await expect(openPdf(bytes, "errada")).rejects.toMatchObject({ reason: "incorrect" });
  });

  it("abre com a senha certa e o resultado une sem ficar em branco", async () => {
    const bytes = await protegido({ ownerPassword: "dono", userPassword: "segredo" });
    const { doc } = await openPdf(bytes, "segredo");

    const unido = await PDFDocument.create();
    for (const p of await unido.copyPages(doc, doc.getPageIndices())) unido.addPage(p);
    const final = await PDFDocument.load(await unido.save());

    const original = await PDFDocument.load(await (await pdfBase()).save());
    expect(conteudo(final)).toEqual(conteudo(original));
  });

  it("deixa passar o erro original quando o arquivo nem é PDF", async () => {
    const err = await openPdf(new Uint8Array([1, 2, 3])).catch((e) => e);
    expect(err).not.toBeInstanceOf(PdfPasswordError);
    expect(String(err.message)).toMatch(/PDF header/);
  });
});
