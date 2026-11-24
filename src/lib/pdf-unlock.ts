/**
 * Abertura de PDFs protegidos, no navegador.
 *
 * O pdf-lib original recusa qualquer PDF criptografado. A saída que ele mesmo
 * sugere no erro, `ignoreEncryption: true`, carrega o arquivo mas NÃO
 * descriptografa nada: as páginas copiadas desse arquivo saem em branco, sem
 * erro nenhum. Por isso a abertura passa pelo @cantoo/pdf-lib, fork do pdf-lib
 * que descriptografa de fato (RC4 40/128, AES-128 e AES-256).
 *
 * Dois tipos de proteção:
 * - Só senha de proprietário (o caso mais comum: extratos de banco, documentos
 *   de órgão público, PDFs com "edição bloqueada"). Qualquer leitor abre sem
 *   pedir senha, e aqui também: descriptografa com a senha de usuário vazia.
 * - Senha de abertura. Só abre com a senha que o usuário digitar.
 *
 * O fork é carregado sob demanda para não pesar no pacote das outras
 * ferramentas de PDF.
 */

type PdfLib = typeof import("@cantoo/pdf-lib");
export type PdfDoc = import("@cantoo/pdf-lib").PDFDocument;

let lib: Promise<PdfLib> | null = null;
export const loadPdfLib = (): Promise<PdfLib> => (lib ??= import("@cantoo/pdf-lib"));

export class PdfPasswordError extends Error {
  constructor(readonly reason: "required" | "incorrect") {
    super(reason === "required" ? "PDF protegido por senha" : "Senha incorreta");
    this.name = "PdfPasswordError";
  }
}

export interface OpenedPdf {
  doc: PdfDoc;
  /** O arquivo era criptografado e foi descriptografado. */
  encrypted: boolean;
}

/**
 * Abre o PDF, descriptografando se precisar. Lança `PdfPasswordError` quando
 * falta a senha de abertura ou ela está errada; qualquer outro erro é o PDF
 * em si (corrompido, não é PDF etc.).
 */
export async function openPdf(bytes: ArrayBuffer | Uint8Array, password?: string): Promise<OpenedPdf> {
  const { PDFDocument, EncryptedPDFError } = await loadPdfLib();
  try {
    return { doc: await PDFDocument.load(bytes), encrypted: false };
  } catch (err) {
    if (!(err instanceof EncryptedPDFError)) throw err;
  }

  // Senha vazia primeiro: resolve os PDFs que só têm senha de proprietário.
  // A senha digitada, se houver, só entra quando o arquivo pede abertura.
  try {
    return { doc: await PDFDocument.load(bytes, { password: "" }), encrypted: true };
  } catch (err) {
    if (errorMessage(err) !== "NEEDS PASSWORD") throw err;
  }
  if (!password) throw new PdfPasswordError("required");
  try {
    return { doc: await PDFDocument.load(bytes, { password }), encrypted: true };
  } catch (err) {
    if (errorMessage(err) === "Password incorrect") throw new PdfPasswordError("incorrect");
    throw err;
  }
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "");
