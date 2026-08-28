/**
 * Ajustes no DOCX antes de renderizar, para o resultado bater com o Word.
 *
 * O `docx-preview` escolhe o cabeçalho de cada página assim:
 *
 *   ref = (titlePage && primeira ? "first" : null)
 *      ?? (indiceDaPagina % 2 == 1 ? "even" : null)
 *      ?? "default"
 *
 * Ou seja, ele usa o cabeçalho **par** em toda página de índice ímpar. Só que o
 * Word só usa o cabeçalho par quando a opção `w:evenAndOddHeaders` está ligada
 * nas configurações do documento — e o docx-preview nunca lê essa opção.
 *
 * Muitos modelos guardam um `headerReference w:type="even"` residual, herdado de
 * alguma edição antiga, que o Word simplesmente ignora. O docx-preview então
 * renderiza esse cabeçalho residual na página 2, e o cabeçalho de verdade some.
 *
 * A correção é remover as referências "even" quando a opção está desligada:
 * aí o `?? "default"` assume, que é o que o Word faz.
 */

/** A opção que liga cabeçalho/rodapé diferente em páginas pares. */
export function evenAndOddHeadersEnabled(settingsXml: string): boolean {
  const m = /<w:evenAndOddHeaders\b([^>]*)\/?>/.exec(settingsXml);
  if (!m) return false;

  const val = /w:val\s*=\s*"([^"]*)"/.exec(m[1]);
  if (!val) return true; // presente sem atributo significa ligado
  const v = val[1].toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

/** Remove as referências de cabeçalho e rodapé do tipo "even". */
export function stripEvenHeaderFooterRefs(documentXml: string): string {
  return documentXml.replace(
    /<w:(?:header|footer)Reference\b[^>]*w:type\s*=\s*"even"[^>]*\/>/g,
    "",
  );
}

/** Diz se vale a pena reescrever o arquivo. */
export function needsEvenRefStrip(settingsXml: string, documentXml: string): boolean {
  if (evenAndOddHeadersEnabled(settingsXml)) return false;
  return /<w:(?:header|footer)Reference\b[^>]*w:type\s*=\s*"even"/.test(documentXml);
}

/**
 * Devolve o DOCX pronto para renderizar.
 *
 * Se nada precisar mudar, devolve o próprio buffer recebido — reescrever um
 * arquivo de vários megabytes à toa custaria caro no navegador.
 */
export async function normalizeDocxForRender(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);

  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return arrayBuffer;

  const settingsFile = zip.file("word/settings.xml");
  const settingsXml = settingsFile ? await settingsFile.async("string") : "";
  const documentXml = await documentFile.async("string");

  if (!needsEvenRefStrip(settingsXml, documentXml)) return arrayBuffer;

  zip.file("word/document.xml", stripEvenHeaderFooterRefs(documentXml));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
