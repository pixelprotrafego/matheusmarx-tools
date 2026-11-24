/**
 * Limpeza e compactação sem perda de um PDF já aberto pelo pdf-lib.
 *
 * Três operações independentes, usadas pelo compressor e pelo removedor de
 * metadados:
 *
 * - `stripMetadata`: apaga o dicionário Info inteiro **e** o XMP. O Word, o
 *   Acrobat e quase todo gerador gravam autor, título e datas nos dois lugares;
 *   limpar só o Info, como se fazia antes, deixava o nome do autor no XMP de um
 *   arquivo apresentado como limpo.
 * - `dropUnreachableObjects`: descarta objetos que nada referencia — sobra de
 *   edições incrementais, que se acumulam em PDF editado ou assinado várias vezes.
 * - `deflateUncompressedStreams`: comprime com Flate os streams gravados crus.
 *
 * Nenhuma das três muda um pixel do que aparece na página.
 */

import { zlibSync } from "fflate";

// Tipos locais, e não os de pdf-unlock: o bot do Telegram também usa este
// módulo, e lá não existe o alias "@/" que o pdf-unlock usa para o pdf.js.
type PdfLib = typeof import("@cantoo/pdf-lib");
type PdfDoc = import("@cantoo/pdf-lib").PDFDocument;
type PdfObject = import("@cantoo/pdf-lib").PDFObject;

/** Remove Info e XMP do documento, das páginas e as sobras de editor. */
export function stripMetadata(lib: PdfLib, doc: PdfDoc): void {
  const { PDFName, PDFDict } = lib;
  const { context, catalog } = doc;

  // O Info inteiro some do trailer: as chaves fora do padrão ("Company",
  // "SourceModified"...) não têm setter no pdf-lib e escapavam da limpeza.
  context.trailerInfo.Info = undefined;

  const XMP = PDFName.of("Metadata");
  const PIECE = PDFName.of("PieceInfo");
  catalog.delete(XMP);
  catalog.delete(PIECE);

  // Página, imagem e formulário também podem carregar XMP próprio.
  for (const [, object] of context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : (object as { dict?: unknown }).dict;
    if (dict instanceof PDFDict) {
      dict.delete(XMP);
      dict.delete(PIECE);
    }
  }
}

/** Apaga os objetos indiretos que não são alcançáveis a partir do trailer. */
export function dropUnreachableObjects(lib: PdfLib, doc: PdfDoc): number {
  const { PDFRef, PDFDict, PDFArray } = lib;
  const { context } = doc;
  const reachable = new Set<string>();

  const visit = (object: PdfObject | undefined) => {
    const stack: (PdfObject | undefined)[] = [object];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      if (current instanceof PDFRef) {
        const key = current.toString();
        if (reachable.has(key)) continue;
        reachable.add(key);
        stack.push(context.lookup(current));
        continue;
      }
      if (current instanceof PDFArray) {
        for (let i = 0; i < current.size(); i++) stack.push(current.get(i));
        continue;
      }
      const dict = current instanceof PDFDict ? current : (current as { dict?: unknown }).dict;
      if (dict instanceof PDFDict) {
        for (const [, value] of dict.entries()) stack.push(value);
      }
    }
  };

  const { Root, Info, Encrypt } = context.trailerInfo;
  visit(Root as PdfObject | undefined);
  visit(Info as PdfObject | undefined);
  visit(Encrypt as PdfObject | undefined);

  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (reachable.has(ref.toString())) continue;
    context.delete(ref);
    removed++;
  }
  return removed;
}

/**
 * A imagem é um JPEG que o canvas consegue recomprimir sem mudar a cor?
 *
 * O canvas do navegador sempre grava JPEG em RGB. Recomprimir assim um JPEG
 * CMYK ou em tons de cinza, mantendo o `/ColorSpace` original no PDF, faz o
 * leitor interpretar os bytes com o espaço de cor errado: a foto sai com as
 * cores trocadas — e um `/Decode` invertido (comum em CMYK do Photoshop) sai
 * em negativo. Por isso só entra aqui o JPEG que já era RGB de 8 bits.
 */
export function isRecompressibleJpeg(lib: PdfLib, doc: PdfDoc, dict: import("@cantoo/pdf-lib").PDFDict): boolean {
  const { PDFName, PDFArray, PDFNumber, PDFRawStream } = lib;
  if (dict.lookup(PDFName.of("Subtype"))?.toString() !== "/Image") return false;

  const filter = dict.lookup(PDFName.of("Filter"));
  const filters = filter instanceof PDFArray ? filter.asArray().map((f) => f.toString()) : [filter?.toString()];
  // Só DCT puro: um JPEG embrulhado em outro filtro não é o que o canvas lê.
  if (filters.length !== 1 || filters[0] !== "/DCTDecode") return false;

  if (dict.has(PDFName.of("Decode"))) return false;
  if (dict.has(PDFName.of("ImageMask"))) return false;
  const bpc = dict.lookup(PDFName.of("BitsPerComponent"));
  if (bpc instanceof PDFNumber && bpc.asNumber() !== 8) return false;

  const cs = dict.lookup(PDFName.of("ColorSpace"));
  if (cs?.toString() === "/DeviceRGB") return true;
  // ICCBased com 3 componentes é RGB com perfil; o perfil continua valendo
  // porque o canvas é instruído a não converter as cores.
  if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0).toString() === "/ICCBased") {
    const profile = doc.context.lookup(cs.get(1));
    if (profile instanceof PDFRawStream) {
      const n = profile.dict.lookup(PDFName.of("N"));
      return n instanceof PDFNumber && n.asNumber() === 3;
    }
  }
  return false;
}

/** Comprime com Flate os streams sem filtro nenhum. */
export function deflateUncompressedStreams(lib: PdfLib, doc: PdfDoc): number {
  const { PDFRawStream, PDFName } = lib;
  const FILTER = PDFName.of("Filter");
  let count = 0;
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    if (object.dict.has(FILTER)) continue;
    const raw = object.contents;
    if (raw.byteLength < 64) continue;
    const packed = zlibSync(raw, { level: 9 });
    if (packed.byteLength >= raw.byteLength) continue;
    const dict = object.dict.clone(doc.context);
    dict.set(FILTER, PDFName.of("FlateDecode"));
    doc.context.assign(ref, PDFRawStream.of(dict, packed));
    count++;
  }
  return count;
}
