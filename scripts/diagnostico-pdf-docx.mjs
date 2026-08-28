#!/usr/bin/env node
/**
 * Roda o conversor de PDF para Word num Chromium de verdade e salva o .docx.
 *
 * Existe pela mesma razão do `diagnostico-docx.mjs`: o conversor depende de
 * canvas, de fontes e do pdf.js com worker, e nada disso se comporta igual fora
 * do navegador. Testar o módulo em Node com jsdom mede outra coisa — as imagens
 * simplesmente não são decodificadas — e passaria uma falsa sensação de que
 * está tudo certo.
 *
 * O código carregado é o mesmo `src/lib/pdf-to-docx` que o site usa, servido
 * pelo Vite. Ao mexer no conversor, não há nada a espelhar aqui.
 *
 * Uso:
 *   node scripts/diagnostico-pdf-docx.mjs "entrada.pdf" [saida.docx]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const [entrada, saidaArg] = process.argv.slice(2);
if (!entrada) {
  console.error("Uso: node scripts/diagnostico-pdf-docx.mjs <entrada.pdf> [saida.docx]");
  process.exit(1);
}

const saida = saidaArg ?? entrada.replace(/\.pdf$/i, "") + ".docx";

const servidor = await createServer({
  server: { port: 5199, strictPort: true },
  logLevel: "warn",
});
await servidor.listen();
const base = `http://localhost:${servidor.config.server.port}/`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
pagina.on("console", (m) => {
  const t = m.text();
  if (!t.startsWith("[vite]")) console.log("  [browser]", t);
});
pagina.on("pageerror", (e) => console.error("  [browser error]", e.message));

try {
  await pagina.goto(base, { waitUntil: "networkidle" });

  const pdfBase64 = readFileSync(resolve(entrada)).toString("base64");

  console.log(`Convertendo ${basename(entrada)}...`);
  const resultado = await pagina.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const modulo = await import("/src/lib/pdf-to-docx/index.ts");
    const passos = [];
    const saida = await modulo.pdfToDocx(bytes.buffer, {
      onProgress: (p, s) => {
        const ultimo = passos[passos.length - 1];
        if (!ultimo || ultimo.status !== s) passos.push({ percent: Math.round(p), status: s });
      },
    });
    const buffer = new Uint8Array(await saida.blob.arrayBuffer());
    let binario = "";
    for (let i = 0; i < buffer.length; i += 0x8000) {
      binario += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    }
    return {
      docx: btoa(binario),
      pages: saida.pages,
      pagesWithoutText: saida.pagesWithoutText,
      passos,
    };
  }, pdfBase64);

  for (const passo of resultado.passos) console.log(`  ${String(passo.percent).padStart(3)}%  ${passo.status}`);

  writeFileSync(resolve(saida), Buffer.from(resultado.docx, "base64"));
  console.log(`\nPáginas lidas: ${resultado.pages} (sem texto: ${resultado.pagesWithoutText})`);
  console.log(`DOCX salvo em: ${saida}`);
} catch (erro) {
  console.error("Falhou:", erro?.message ?? erro);
  process.exitCode = 1;
} finally {
  await navegador.close();
  await servidor.close();
}
