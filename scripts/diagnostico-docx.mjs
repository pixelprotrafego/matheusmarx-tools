#!/usr/bin/env node
/**
 * Renderiza um .docx num Chromium de verdade, com exatamente as mesmas opções e
 * o mesmo CSS que o conversor usa, e imprime a geometria real de cada seção e
 * de cada forma VML.
 *
 * Existe porque corrigir o posicionamento do fundo da página "no escuro", só
 * lendo o código do docx-preview, produziu uma correção errada: a largura que o
 * `getBoundingClientRect()` devolve não é a que o navegador pinta, porque o
 * docx-preview reescreve os atributos `width`/`height` do `<svg>` depois, num
 * `requestAnimationFrame`.
 *
 * Uso:
 *   node scripts/diagnostico-docx.mjs "arquivo.docx"                → só mede
 *   node scripts/diagnostico-docx.mjs "arquivo.docx" --fix          → mede já corrigido
 *   node scripts/diagnostico-docx.mjs "arquivo.docx" --shot "pasta" → salva PNG por página
 *
 * A lógica de `--fix` espelha `fixVmlPositioning` em DocxToPdf.tsx e
 * `resolveMsoOffset` em src/lib/docx-vml-position.ts. Ao mexer em um, mexa aqui.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import JSZip from "jszip";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arquivo = args[0];
const aplicarFix = args.includes("--fix");
const pastaShot = args.includes("--shot") ? args[args.indexOf("--shot") + 1] : null;

if (!arquivo) {
  console.error("Informe o caminho do .docx.");
  process.exit(1);
}

// O build UMD do docx-preview espera o JSZip como global; carrega antes.
const jszip = join(raiz, "node_modules", "jszip", "dist", "jszip.min.js");
const umd = join(raiz, "node_modules", "docx-preview", "dist", "docx-preview.min.js");
/**
 * Mesma normalização de src/lib/docx-normalize.ts: sem `evenAndOddHeaders`
 * ligado, as referências "even" são resíduo que o Word ignora — e que fazia o
 * docx-preview trocar o cabeçalho da página 2.
 */
let bytesDocx = readFileSync(arquivo);
if (aplicarFix) {
  const zip = await JSZip.loadAsync(bytesDocx);
  const settings = zip.file("word/settings.xml");
  const settingsXml = settings ? await settings.async("string") : "";
  const documentXml = await zip.file("word/document.xml").async("string");
  const ligado = /<w:evenAndOddHeaders\b([^>]*)\/?>/.test(settingsXml)
    && !/w:val\s*=\s*"(0|false|off)"/.test(settingsXml);

  if (!ligado && /<w:(?:header|footer)Reference\b[^>]*w:type\s*=\s*"even"/.test(documentXml)) {
    zip.file("word/document.xml", documentXml.replace(
      /<w:(?:header|footer)Reference\b[^>]*w:type\s*=\s*"even"[^>]*\/>/g, ""));
    bytesDocx = Buffer.from(await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" }));
    console.error("  [fix] referências de cabeçalho/rodapé 'even' removidas");
  }
}
const base64 = bytesDocx.toString("base64");

/** O mesmo CSS de `src/index.css`, para a medição valer para o app. */
const CSS = `
  html, body { margin: 0; padding: 0; background: #fff; }
  .docx-render-host {
    /* left:0 e não -10000px: aqui o host precisa ser alcançável por
       elementsFromPoint, que trabalha em coordenadas da janela. */
    position: absolute; top: 0; left: 0; z-index: -1;
    width: max-content; min-width: 900px;
    /* sem `pointer-events: none` de propósito: ele impediria elementsFromPoint */
    background: #ffffff; color: #000000; color-scheme: light;
  }
  .docx-render-host * { color-scheme: light; }
  .docx-render-host .docx-wrapper { background: #ffffff; padding: 0; }
  .docx-render-host section.docx { background: #ffffff; box-shadow: none; margin: 0; }
  .docx-render-host .docx { hyphens: manual; }
  .docx-render-host .docx span { overflow-wrap: normal; word-break: normal; }
`;

const navegador = await chromium.launch();
// Janela alta o bastante para as duas páginas caberem: elementsFromPoint só
// enxerga o que está dentro da viewport.
const page = await navegador.newPage({ viewport: { width: 1100, height: 2600 } });
page.on("console", (m) => { if (m.type() === "error") console.error("  [browser]", m.text()); });

await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="docx-render-host" id="host"></div></body></html>`);
await page.addScriptTag({ path: jszip });
await page.addScriptTag({ path: umd });
await page.evaluate((v) => { window.__APLICAR_FIX__ = v; }, aplicarFix);

const relatorio = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const host = document.getElementById("host");
  await window.docx.renderAsync(bytes.buffer, host, undefined, {
    className: "docx",
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderChanges: false,
    ignoreWidth: false,
    ignoreHeight: false,
    experimental: true,
    useBase64URL: true,
    trimXmlDeclaration: true,
  });

  try { await document.fonts.ready; } catch { /* noop */ }
  await Promise.all(Array.from(host.querySelectorAll("img")).map((img) =>
    img.complete ? Promise.resolve() : new Promise((r) => {
      img.addEventListener("load", r, { once: true });
      img.addEventListener("error", r, { once: true });
      setTimeout(r, 4000);
    })));
  // O docx-preview ajusta o tamanho dos <svg> em rAF; espera dois quadros.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  if (window.__APLICAR_FIX__) {
    for (const section of host.querySelectorAll("section.docx")) {
      const sr = section.getBoundingClientRect();
      const cs = getComputedStyle(section);
      const p = {
        left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0,
        top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0,
      };
      const conteudo = {
        left: p.left, top: p.top,
        width: sr.width - p.left - p.right, height: sr.height - p.top - p.bottom,
      };

      for (const svg of section.querySelectorAll("svg[style]")) {
        const st = svg.getAttribute("style") || "";
        if (!/mso-position-(horizontal|vertical)/i.test(st)) continue;
        const r = svg.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) continue;

        const prop = (n) => {
          const m = new RegExp(`(?:^|;)\\s*${n}\\s*:\\s*([^;]+)`, "i").exec(st);
          return m ? m[1].trim().toLowerCase() : undefined;
        };
        const alinhar = (a, ini, tam, forma) =>
          a === "center" ? ini + (tam - forma) / 2
            : a === "right" || a === "bottom" || a === "outside" ? ini + tam - forma
            : a === "left" || a === "top" || a === "inside" ? ini
            : NaN;

        const h = prop("mso-position-horizontal");
        const hr = prop("mso-position-horizontal-relative");
        const v = prop("mso-position-vertical");
        const vr = prop("mso-position-vertical-relative");

        const cxH = hr === "page" ? { i: 0, t: sr.width } : { i: conteudo.left, t: conteudo.width };
        const cxV = vr === "page" ? { i: 0, t: sr.height } : { i: conteudo.top, t: conteudo.height };

        const L = h ? alinhar(h, cxH.i, cxH.t, r.width) : NaN;
        const T = v ? alinhar(v, cxV.i, cxV.t, r.height) : NaN;
        if (Number.isFinite(L)) { svg.style.left = `${L}px`; svg.style.marginLeft = "0px"; }
        if (Number.isFinite(T)) { svg.style.top = `${T}px`; svg.style.marginTop = "0px"; }
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
  }

  const num = (v) => Math.round(v * 10) / 10;
  const caixa = (el, origem) => {
    const r = el.getBoundingClientRect();
    return {
      x: num(r.left - origem.left), y: num(r.top - origem.top),
      w: num(r.width), h: num(r.height),
    };
  };

  const hostRect = host.getBoundingClientRect();
  const out = { host: { w: num(hostRect.width), h: num(hostRect.height) }, secoes: [] };

  for (const section of host.querySelectorAll("section.docx")) {
    const sr = section.getBoundingClientRect();
    const cs = getComputedStyle(section);
    const info = {
      rect: { w: num(sr.width), h: num(sr.height) },
      minHeight: cs.minHeight,
      padding: { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft },
      position: cs.position,
      overflow: cs.overflow,
      filhos: Array.from(section.children).map((c) => ({
        tag: c.tagName.toLowerCase(),
        cls: c.className?.toString?.() ?? "",
        ...caixa(c, sr),
      })),
      svgs: [],
    };

    for (const svg of section.querySelectorAll("svg")) {
      const scs = getComputedStyle(svg);
      const filho = svg.firstElementChild;
      info.svgs.push({
        styleAttr: svg.getAttribute("style") ?? "",
        attrW: svg.getAttribute("width"),
        attrH: svg.getAttribute("height"),
        viewBox: svg.getAttribute("viewBox"),
        computed: {
          position: scs.position, left: scs.left, top: scs.top,
          marginLeft: scs.marginLeft, marginTop: scs.marginTop,
          width: scs.width, height: scs.height, zIndex: scs.zIndex,
          overflow: scs.overflow,
        },
        rect: caixa(svg, sr),
        offsetParent: svg.offsetParent ? svg.offsetParent.tagName.toLowerCase() + "." + (svg.offsetParent.className?.toString?.() ?? "") : null,
        filho: filho ? {
          tag: filho.tagName.toLowerCase(),
          w: filho.getAttribute("width"), h: filho.getAttribute("height"),
          href: (filho.getAttribute("href") || "").slice(0, 30),
          rect: caixa(filho, sr),
        } : null,
      });
    }

    // Sonda vertical: em que altura o fundo deixa de cobrir a página, e o que
    // está por cima ali. Serve para achar faixas brancas no fim da página.
    info.sonda = [];
    const cx = sr.left + sr.width * 0.5;
    for (const frac of [0.5, 0.9, 0.95, 0.97, 0.99, 0.995]) {
      const cy = sr.top + sr.height * frac;
      const pilha = document.elementsFromPoint(cx, cy).slice(0, 4).map((e) => {
        const cls = e.className?.baseVal ?? e.className?.toString?.() ?? "";
        return e.tagName.toLowerCase() + (cls ? "." + cls.split(" ")[0] : "");
      });
      info.sonda.push({ emY: num(sr.height * frac), doFim: num(sr.height * (1 - frac)), pilha });
    }

    out.secoes.push(info);
  }

  return out;
}, base64);

console.log(JSON.stringify(relatorio, null, 2));

if (pastaShot) {
  // O host fica fora da tela; traz para 0,0 só para o screenshot.
  await page.evaluate(() => { document.getElementById("host").style.left = "0px"; });
  // As <image> dentro dos <svg> do VML pintam depois do layout; sem esta espera
  // o print sai sem o fundo da página.
  await page.waitForTimeout(1500);
  const secoes = await page.$$("#host section.docx");
  for (let i = 0; i < secoes.length; i++) {
    const destino = join(pastaShot, `${aplicarFix ? "corrigido" : "atual"}-p${i + 1}.png`);
    await secoes[i].screenshot({ path: destino });
    console.error(`  print: ${destino}`);
  }
}

await navegador.close();
