/**
 * Abertura de PDFs protegidos, no navegador.
 *
 * O pdf-lib original recusa qualquer PDF criptografado. A saída que ele mesmo
 * sugere no erro, `ignoreEncryption: true`, carrega o arquivo mas NÃO
 * descriptografa nada: as páginas copiadas desse arquivo saem em branco, sem
 * erro nenhum. Por isso o projeto usa o @cantoo/pdf-lib, fork do pdf-lib que
 * descriptografa de fato (RC4 40/128, AES-128 e AES-256).
 *
 * Dois tipos de proteção:
 * - Só senha de proprietário (o caso mais comum: extratos de banco, documentos
 *   de órgão público, PDFs com "edição bloqueada"). Qualquer leitor abre sem
 *   pedir senha, e aqui também: descriptografa com a senha de usuário vazia.
 * - Senha de abertura. Só abre com a senha que o usuário digitar.
 *
 * O fork é carregado sob demanda para não pesar na página inicial.
 */

import { dropUnreachableObjects } from "./pdf-cleanup";

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
  /**
   * A senha que foi preciso digitar para abrir, quando havia uma. Serve para
   * proteger o resultado com a mesma senha: o fork salva sem criptografia, e
   * um PDF que pedia senha não pode sair aberto sem a pessoa perceber.
   */
  openPassword?: string;
}

/**
 * Abre o PDF, descriptografando se precisar. Lança `PdfPasswordError` quando
 * falta a senha de abertura ou ela está errada; qualquer outro erro é o PDF
 * em si (corrompido, não é PDF etc.).
 */
export async function openPdf(
  bytes: ArrayBuffer | Uint8Array,
  password?: string,
  options: { updateMetadata?: boolean } = {},
): Promise<OpenedPdf> {
  const lib = await loadPdfLib();
  const { PDFDocument, EncryptedPDFError } = lib;
  const base = { updateMetadata: options.updateMetadata };
  // O parser guarda como objetos comuns as sobras do arquivo original: o XRef
  // stream (às vezes como objeto inválido, com os bytes crus), os contêineres
  // ObjStm, o dicionário de criptografia e o Info antigo. Ao salvar, tudo isso
  // seria regravado — e num PDF criptografado o XRef stream traz o
  // `/Encrypt`, que fazia o próximo leitor achar que o resultado ainda era
  // criptografado: o extrato de banco girado saía impossível de abrir. Nada
  // disso é alcançável a partir do trailer, então descartar é sem perda.
  const opened = (result: OpenedPdf): OpenedPdf => {
    dropUnreachableObjects(lib, result.doc);
    return result;
  };
  try {
    return opened({ doc: await PDFDocument.load(bytes, base), encrypted: false });
  } catch (err) {
    if (!(err instanceof EncryptedPDFError)) throw err;
  }

  // Senha vazia primeiro: resolve os PDFs que só têm senha de proprietário.
  // A senha digitada, se houver, só entra quando o arquivo pede abertura.
  try {
    return opened({ doc: await PDFDocument.load(bytes, { ...base, password: "" }), encrypted: true });
  } catch (err) {
    if (errorMessage(err) !== "NEEDS PASSWORD") throw err;
  }
  if (!password) throw new PdfPasswordError("required");
  try {
    return opened({ doc: await PDFDocument.load(bytes, { ...base, password }), encrypted: true, openPassword: password });
  } catch (err) {
    if (errorMessage(err) === "Password incorrect") throw new PdfPasswordError("incorrect");
    throw err;
  }
}

/**
 * Devolve ao resultado a senha de abertura que o original tinha.
 *
 * A senha de proprietário original não é conhecida (quem abre com a senha de
 * usuário não a descobre), então a mesma senha vale para as duas: o arquivo
 * continua pedindo senha para abrir, como antes, sem restrições extras.
 */
export function keepOpenPassword(opened: OpenedPdf): void {
  if (!opened.openPassword) return;
  opened.doc.encrypt({ userPassword: opened.openPassword, ownerPassword: opened.openPassword });
}

/**
 * Abre com o pdf.js, para as ferramentas que desenham ou leem o texto.
 *
 * O pdf.js já abre sozinho o PDF com só senha de proprietário; o que falta é
 * traduzir o pedido de senha de abertura para o mesmo erro do resto do
 * projeto, para a tela pedir a senha em vez de mostrar uma mensagem técnica.
 */
export async function openPdfjs(bytes: ArrayBuffer | Uint8Array, password?: string) {
  const { pdfjsLib } = await import("@/lib/pdfjs-setup");
  // O pdf.js transfere o buffer para o worker e o deixa inutilizável aqui. Uma
  // cópia por tentativa é o que permite tentar de novo com outra senha.
  const data = (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).slice();
  try {
    return await pdfjsLib.getDocument({ data, password: password || undefined }).promise;
  } catch (err) {
    const e = err as { name?: string; code?: number };
    if (e?.name === "PasswordException") {
      // 1 = precisa de senha, 2 = senha incorreta (PasswordResponses do pdf.js).
      throw new PdfPasswordError(e.code === 2 && password ? "incorrect" : "required");
    }
    throw err;
  }
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "");
