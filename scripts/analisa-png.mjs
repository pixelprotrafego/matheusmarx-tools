#!/usr/bin/env node
/**
 * Decodifica um PNG RGB de 8 bits e procura emendas — colunas ou linhas onde a
 * imagem muda de tom de forma abrupta e consistente. É como se detectou que o
 * fundo da página estava deslocado, em vez de julgar no olho.
 *
 * Uso:  node scripts/analisa-png.mjs arquivo.png [escala]
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const arquivo = process.argv[2];
const escala = Number(process.argv[3] ?? 3);

const buf = readFileSync(arquivo);
let pos = 8, largura = 0, altura = 0, colorType = 2;
const idat = [];
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const tipo = buf.toString("latin1", pos + 4, pos + 8);
  const dados = buf.subarray(pos + 8, pos + 8 + len);
  if (tipo === "IHDR") { largura = dados.readUInt32BE(0); altura = dados.readUInt32BE(4); colorType = dados[9]; }
  else if (tipo === "IDAT") idat.push(dados);
  else if (tipo === "IEND") break;
  pos += 12 + len;
}

const canais = colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
const raw = inflateSync(Buffer.concat(idat));
const stride = largura * canais;
const px = Buffer.alloc(altura * stride);
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};
for (let y = 0; y < altura; y++) {
  const f = raw[y * (stride + 1)];
  const linha = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= canais ? px[y * stride + x - canais] : 0;
    const b = y > 0 ? px[(y - 1) * stride + x] : 0;
    const c = x >= canais && y > 0 ? px[(y - 1) * stride + x - canais] : 0;
    let v = linha[x];
    if (f === 1) v += a; else if (f === 2) v += b;
    else if (f === 3) v += (a + b) >> 1; else if (f === 4) v += paeth(a, b, c);
    px[y * stride + x] = v & 0xff;
  }
}

const lum = (x, y) => {
  const i = y * stride + x * canais;
  return canais === 1 ? px[i] : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
};
const mm = (p) => ((p / escala) * 25.4 / 96).toFixed(1);

console.log(`${arquivo}`);
console.log(`  ${largura}x${altura}px  (escala ${escala} => ${mm(largura)}x${mm(altura)} mm)`);

// Emendas verticais (colunas), medidas na metade inferior.
const linhasAmostra = [];
for (let y = Math.floor(altura * 0.55); y < altura - 2; y += 9) linhasAmostra.push(y);
const colunas = new Map();
for (const y of linhasAmostra)
  for (let x = 1; x < largura; x++)
    if (Math.abs(lum(x, y) - lum(x - 1, y)) > 6) colunas.set(x, (colunas.get(x) ?? 0) + 1);
const colFortes = [...colunas.entries()].filter(([, n]) => n > linhasAmostra.length * 0.6).sort((a, b) => b[1] - a[1]);
console.log(`\n  Emendas verticais: ${colFortes.length ? "" : "nenhuma"}`);
for (const [x, n] of colFortes.slice(0, 5)) console.log(`    x=${x}px (${mm(x)} mm) em ${n}/${linhasAmostra.length} linhas`);

// Emendas horizontais (linhas), varrendo a página inteira.
const colunasAmostra = [];
for (let x = Math.floor(largura * 0.05); x < largura * 0.95; x += 11) colunasAmostra.push(x);
const linhas = new Map();
for (const x of colunasAmostra)
  for (let y = 1; y < altura; y++)
    if (Math.abs(lum(x, y) - lum(x, y - 1)) > 6) linhas.set(y, (linhas.get(y) ?? 0) + 1);
const linFortes = [...linhas.entries()].filter(([, n]) => n > colunasAmostra.length * 0.6).sort((a, b) => a[0] - b[0]);
console.log(`\n  Emendas horizontais: ${linFortes.length ? "" : "nenhuma"}`);
for (const [y, n] of linFortes.slice(0, 12)) {
  const doFim = altura - y;
  console.log(`    y=${y}px (${mm(y)} mm do topo, ${mm(doFim)} mm do fim) em ${n}/${colunasAmostra.length} colunas`);
}

// Perfil vertical das últimas linhas, para ver como a página termina.
console.log(`\n  Luminância média das últimas 12 faixas (do fim para cima):`);
for (let k = 1; k <= 12; k++) {
  const y = altura - k * 10;
  if (y < 0) break;
  let soma = 0;
  for (const x of colunasAmostra) soma += lum(x, y);
  console.log(`    ${String(k * 10).padStart(4)}px do fim (${mm(k * 10).padStart(5)} mm): ${(soma / colunasAmostra.length).toFixed(1)}`);
}
