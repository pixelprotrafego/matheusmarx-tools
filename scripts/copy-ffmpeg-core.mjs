#!/usr/bin/env node
/**
 * Copia o motor do ffmpeg para `public/ffmpeg/`, para o site servi-lo do
 * próprio domínio em vez de buscá-lo no unpkg ou no jsdelivr.
 *
 * O projeto promete que nada sai da máquina de quem usa. Os arquivos do usuário
 * de fato nunca saíam — mas o *código* do motor vinha de um CDN de terceiros a
 * cada primeira conversão de vídeo, o que faz o site não funcionar offline e
 * entrega o IP de quem usa para o CDN. Servindo do mesmo domínio, some as duas
 * coisas.
 *
 * Os arquivos não vão para o Git (são ~31 MB): este script roda sozinho antes
 * do `dev` e do `build`, via os hooks `predev` e `prebuild` do npm.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destino = join(root, "public", "ffmpeg");

const coreUmd = join(root, "node_modules", "@ffmpeg", "core", "dist", "umd");
const ffmpegEsm = join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");

if (!existsSync(coreUmd) || !existsSync(ffmpegEsm)) {
  console.error("[ffmpeg] Pacotes @ffmpeg/core e @ffmpeg/ffmpeg não encontrados.");
  console.error("[ffmpeg] Rode `npm install` antes de `npm run dev` ou `npm run build`.");
  process.exit(1);
}

mkdirSync(destino, { recursive: true });

const copiar = (origem, arquivo) => {
  const de = join(origem, arquivo);
  const para = join(destino, arquivo);

  // Arquivo de 31 MB: só copia se mudou, senão todo `npm run dev` pagaria o preço.
  if (existsSync(para) && statSync(para).size === statSync(de).size) return 0;

  copyFileSync(de, para);
  return statSync(para).size;
};

let copiados = 0;
let bytes = 0;

// O núcleo: o .js carregador e o .wasm de verdade.
for (const arquivo of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  const n = copiar(coreUmd, arquivo);
  if (n) { copiados++; bytes += n; }
}

// O worker da biblioteca importa ./const.js e ./errors.js por caminho relativo,
// então o conjunto de .js precisa ir junto — são poucos kB.
for (const arquivo of readdirSync(ffmpegEsm).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
  const n = copiar(ffmpegEsm, arquivo);
  if (n) { copiados++; bytes += n; }
}

if (copiados === 0) {
  console.log("[ffmpeg] Motor já estava em public/ffmpeg — nada a copiar.");
} else {
  console.log(`[ffmpeg] ${copiados} arquivo(s) copiado(s) para public/ffmpeg (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
}
