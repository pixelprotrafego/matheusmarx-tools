// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as lib from "@cantoo/pdf-lib";
import { PDFDocument, PDFName, PDFRawStream, PDFString, StandardFonts, decodePDFRawStream } from "@cantoo/pdf-lib";
import {
  deflateUncompressedStreams,
  dropUnreachableObjects,
  isRecompressibleJpeg,
  stripMetadata,
} from "@/lib/pdf-cleanup";
import { keepOpenPassword, openPdf, PdfPasswordError } from "@/lib/pdf-unlock";

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

async function documentoComMetadados(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText("conteudo da pagina", { x: 20, y: 100, size: 12, font: fonte });
  doc.setAuthor("Fulano de Tal");
  doc.setTitle("Relatorio interno");
  // Chave fora do padrão, como as que o Word grava.
  (doc.context.lookup(doc.context.trailerInfo.Info) as lib.PDFDict).set(PDFName.of("Company"), PDFString.of("Empresa Secreta"));
  // XMP com o mesmo autor, como o Acrobat e o Word gravam.
  const xmp = doc.context.stream("<x:xmpmeta><dc:creator>Fulano de Tal</dc:creator></x:xmpmeta>", {
    Type: "Metadata",
    Subtype: "XML",
  });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(xmp));
  return doc.save({ useObjectStreams: false });
}

describe("stripMetadata", () => {
  it("apaga o Info inteiro, inclusive chaves fora do padrão, e o XMP", async () => {
    const original = await documentoComMetadados();
    expect(latin1(original)).toContain("Fulano de Tal");

    const doc = await PDFDocument.load(original, { updateMetadata: false });
    stripMetadata(lib, doc);
    dropUnreachableObjects(lib, doc);
    const limpo = await doc.save({ useObjectStreams: false });

    const texto = latin1(limpo);
    expect(texto).not.toContain("Fulano de Tal");
    expect(texto).not.toContain("Empresa Secreta");
    expect(texto).not.toContain("Relatorio interno");
    const relido = await PDFDocument.load(limpo);
    expect(relido.getPageCount()).toBe(1);
    expect(relido.catalog.has(PDFName.of("Metadata"))).toBe(false);
  });
});

describe("dropUnreachableObjects", () => {
  it("descarta objeto que nada referencia — a sobra de edição incremental", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.context.register(PDFString.of("autor da versao antiga"));
    expect(dropUnreachableObjects(lib, doc)).toBeGreaterThan(0);
    const bytes = await doc.save({ useObjectStreams: false });
    expect(latin1(bytes)).not.toContain("autor da versao antiga");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe("deflateUncompressedStreams", () => {
  it("comprime stream cru sem mudar o conteúdo", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const conteudo = new TextEncoder().encode("0 0 m 100 100 l S\n".repeat(200));
    const ref = doc.context.register(PDFRawStream.of(doc.context.obj({}), conteudo));
    doc.catalog.set(PDFName.of("Dados"), ref);

    expect(deflateUncompressedStreams(lib, doc)).toBe(1);
    const stream = doc.context.lookup(ref) as PDFRawStream;
    expect(stream.dict.get(PDFName.of("Filter"))?.toString()).toBe("/FlateDecode");
    expect(stream.contents.byteLength).toBeLessThan(conteudo.byteLength);
    expect(decodePDFRawStream(stream).decode()).toEqual(conteudo);
  });
});

describe("isRecompressibleJpeg", () => {
  const imagem = async (extra: Record<string, unknown>) => {
    const doc = await PDFDocument.create();
    const dict = doc.context.obj({ Type: "XObject", Subtype: "Image", Filter: "DCTDecode", BitsPerComponent: 8, Width: 10, Height: 10, ...extra });
    return { doc, dict };
  };

  it("aceita JPEG RGB", async () => {
    const { doc, dict } = await imagem({ ColorSpace: "DeviceRGB" });
    expect(isRecompressibleJpeg(lib, doc, dict)).toBe(true);
  });

  it("recusa CMYK, cinza e Decode invertido, que o canvas estragaria", async () => {
    for (const extra of [
      { ColorSpace: "DeviceCMYK" },
      { ColorSpace: "DeviceGray" },
      { ColorSpace: "DeviceRGB", Decode: [1, 0, 1, 0, 1, 0] },
    ]) {
      const { doc, dict } = await imagem(extra);
      expect(isRecompressibleJpeg(lib, doc, dict)).toBe(false);
    }
  });

  it("aceita ICCBased de 3 componentes e recusa o de 4", async () => {
    for (const [n, esperado] of [[3, true], [4, false]] as const) {
      const doc = await PDFDocument.create();
      const perfil = doc.context.register(PDFRawStream.of(doc.context.obj({ N: n }), new Uint8Array(4)));
      const dict = doc.context.obj({
        Subtype: "Image", Filter: "DCTDecode", BitsPerComponent: 8,
        ColorSpace: [PDFName.of("ICCBased"), perfil],
      });
      expect(isRecompressibleJpeg(lib, doc, dict)).toBe(esperado);
    }
  });
});

describe("keepOpenPassword", () => {
  it("o resultado continua pedindo a senha que o original pedia", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.encrypt({ userPassword: "segredo", ownerPassword: "dono" });
    const protegido = await doc.save();

    const aberto = await openPdf(protegido, "segredo");
    expect(aberto.openPassword).toBe("segredo");
    aberto.doc.getPage(0).setRotation(lib.degrees(90));
    keepOpenPassword(aberto);
    const salvo = await aberto.doc.save();

    await expect(openPdf(salvo)).rejects.toBeInstanceOf(PdfPasswordError);
    const reaberto = await openPdf(salvo, "segredo");
    expect(reaberto.doc.getPage(0).getRotation().angle).toBe(90);
  });

  it("PDF só com senha de proprietário não ganha senha de abertura", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.encrypt({ ownerPassword: "dono", permissions: { modifying: false } });
    const aberto = await openPdf(await doc.save());
    expect(aberto.openPassword).toBeUndefined();
    keepOpenPassword(aberto);
    expect((await openPdf(await aberto.doc.save())).encrypted).toBe(false);
  });
});
