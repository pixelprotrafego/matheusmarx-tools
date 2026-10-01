import { Jimp } from "jimp";
import { PDFDocument } from "pdf-lib";

export type ImageTarget = "png" | "jpeg" | "webp";

export interface ConvertedImage {
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

const lerImagem = (bytes: Uint8Array) => Jimp.read(Buffer.from(bytes));

/**
 * Converte a imagem para o formato pedido.
 *
 * O Jimp não codifica WebP. Pedido de WebP sai em PNG, e quem chama avisa a
 * pessoa na legenda — o arquivo vem sem perda, só não no formato pedido.
 */
export async function convertImage(bytes: Uint8Array, alvo: ImageTarget): Promise<ConvertedImage> {
  const img = await lerImagem(bytes);
  if (alvo === "jpeg") {
    return { bytes: new Uint8Array(await img.getBuffer("image/jpeg")), mime: "image/jpeg", ext: "jpg" };
  }
  return { bytes: new Uint8Array(await img.getBuffer("image/png")), mime: "image/png", ext: "png" };
}

export async function resizeImage(bytes: Uint8Array, largura: number, mime: string): Promise<Uint8Array> {
  if (!Number.isFinite(largura) || largura < 16 || largura > 8000) {
    throw new Error("Largura entre 16 e 8000.");
  }
  const img = await lerImagem(bytes);
  img.resize({ w: largura });
  const saida = (mime || "").includes("png") ? "image/png" : "image/jpeg";
  return new Uint8Array(await img.getBuffer(saida));
}

/** Uma página do tamanho exato da imagem, sem margem nem reamostragem. */
export async function imageToPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const m = (mime || "").toLowerCase();
  const img = m.includes("png")
    ? await doc.embedPng(bytes)
    : m.includes("jpeg") || m.includes("jpg")
      ? await doc.embedJpg(bytes)
      : await doc.embedPng((await convertImage(bytes, "png")).bytes);
  const pagina = doc.addPage([img.width, img.height]);
  pagina.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  return doc.save();
}
