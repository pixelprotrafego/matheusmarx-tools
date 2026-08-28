#!/usr/bin/env node
/**
 * Abre um PDF gerado pelo conversor e extrai a imagem de cada página como PNG.
 *
 * O jsPDF grava cada página como um XObject com /FlateDecode e /Predictor >= 10,
 * que é exatamente a filtragem do PNG — então dá para remontar um PNG válido
 * reembrulhando o stream, sem depender de nenhuma biblioteca nativa.
 *
 * Uso:  node scripts/inspeciona-pdf.mjs "arquivo.pdf" "pasta-de-saida" [prefixo]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFNumber } from "pdf-lib";

const [entrada, saidaDir, prefixo = "pagina"] = process.argv.slice(2);
if (!entrada) {
  console.error("Uso: node scripts/inspeciona-pdf.mjs <arquivo.pdf> [pasta] [prefixo]");
  process.exit(1);
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (tipo, d) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), d]);
  const cs = Buffer.alloc(4); cs.writeUInt32BE(crc(corpo));
  return Buffer.concat([len, corpo, cs]);
};
const montarPng = (w, h, ct, zlib) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = ct;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib), chunk("IEND", Buffer.alloc(0)),
  ]);
};

const pdf = await PDFDocument.load(readFileSync(entrada), { updateMetadata: false });
const paginas = pdf.getPages();
console.log(`Páginas: ${paginas.length}`);

const vistos = new Set();
for (let i = 0; i < paginas.length; i++) {
  const page = paginas[i];
  const { width, height } = page.getSize();
  console.log(`\n--- Página ${i + 1} --- ${width.toFixed(1)}x${height.toFixed(1)}pt (${(width * 25.4 / 72).toFixed(1)}x${(height * 25.4 / 72).toFixed(1)}mm)`);

  const xobjs = page.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  if (!xobjs) { console.log("  (sem imagem)"); continue; }

  for (const [nome, ref] of xobjs.entries()) {
    const chave = nome.toString().slice(1);
    if (vistos.has(chave)) continue;
    const stream = pdf.context.lookup(ref);
    if (!(stream instanceof PDFRawStream)) continue;
    if (stream.dict.lookup(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    vistos.add(chave);

    const w = stream.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const h = stream.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    const filtro = stream.dict.lookup(PDFName.of("Filter"))?.toString() ?? "";
    const cs = stream.dict.lookup(PDFName.of("ColorSpace"))?.toString() ?? "";
    console.log(`  /${chave}: ${w}x${h}px ${filtro} ${cs} ${stream.contents.length} bytes`);

    if (filtro.includes("FlateDecode") && saidaDir) {
      const destino = join(saidaDir, `${prefixo}-${chave}.png`);
      writeFileSync(destino, montarPng(w, h, cs.includes("Gray") ? 0 : 2, Buffer.from(stream.contents)));
      console.log(`    -> ${destino}`);
    }
  }
}
