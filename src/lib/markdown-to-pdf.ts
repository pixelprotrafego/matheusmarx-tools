/**
 * Markdown para PDF, com a formatação do Markdown inteira.
 *
 * O texto é lido pelo `marked` (o mesmo padrão GFM do GitHub) e montado no
 * modelo do Word para PDF: o motor quebra linhas, pagina e grava texto real.
 * Negrito, itálico, tachado, código, links, listas aninhadas, listas de
 * tarefas, citações, tabelas e linhas horizontais saem como no original — a
 * versão anterior tirava toda a formatação dentro da linha e juntava tudo em
 * Helvetica.
 *
 * Imagem só entra quando vem dentro do próprio arquivo (data:): buscar uma
 * imagem na internet mandaria o endereço do usuário a um terceiro.
 */

import type { Token, Tokens } from "marked";
import { modelToPdf } from "./docx-to-pdf";
import type { Block, Border, DocModel, ImageRef, Inline, Paragraph, ParaProps, RunProps, Table } from "./docx-to-pdf/model";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56.7; // 2 cm
const TEXT_W = PAGE_W - 2 * MARGIN;

const BASE: RunProps = {
  font: "Calibri", size: 11, bold: false, italic: false, underline: null, strike: false, doubleStrike: false,
  color: "#1F2328", highlight: null, shading: null, vertAlign: null, caps: false, smallCaps: false, hidden: false,
  spacing: 0, position: 0,
};
const MONO = "Courier New";
const LINK_COLOR = "#0969DA";
const RULE: Border = { width: 0.75, color: "#D0D7DE", style: "solid", space: 4 };

function para(inlines: Inline[], over: Partial<ParaProps> = {}, mark: RunProps = BASE): Paragraph {
  return {
    kind: "p",
    props: {
      styleId: null, align: "left", indLeft: 0, indRight: 0, indFirst: 0, spaceBefore: 0, spaceAfter: 8,
      line: 1.15, lineRule: "auto", contextual: false, keepNext: false, keepLines: false, pageBreakBefore: false,
      widowControl: true, tabs: [], shading: null, borders: {}, markProps: mark, ...over,
    },
    marker: null,
    inlines,
  };
}

/** Imagem embutida (data:), com o tamanho natural limitado à largura útil. */
async function dataImage(src: string, maxWidth: number): Promise<ImageRef | null> {
  const m = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,(.+)$/i.exec(src.trim());
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: m[1] }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      let w = (img.naturalWidth || 100) * 0.75;
      let h = (img.naturalHeight || 100) * 0.75;
      if (w > maxWidth) {
        h *= maxWidth / w;
        w = maxWidth;
      }
      return { data: bytes, mime: m[1].toLowerCase(), width: w, height: h };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

interface Ctx {
  width: number;
  color: string | null;
}

async function inlines(tokens: Token[] | undefined, run: RunProps, ctx: Ctx, link?: string): Promise<Inline[]> {
  const out: Inline[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text":
      case "escape": {
        const tt = t as Tokens.Text;
        // Quebra de linha simples dentro do parágrafo é espaço (CommonMark);
        // a quebra forçada vem como token "br".
        if (tt.tokens?.length) out.push(...(await inlines(tt.tokens, run, ctx, link)));
        else out.push({ kind: "text", text: decode(tt.text).replace(/\n/g, " "), props: run, link });
        break;
      }
      case "strong":
        out.push(...(await inlines((t as Tokens.Strong).tokens, { ...run, bold: true }, ctx, link)));
        break;
      case "em":
        out.push(...(await inlines((t as Tokens.Em).tokens, { ...run, italic: true }, ctx, link)));
        break;
      case "del":
        out.push(...(await inlines((t as Tokens.Del).tokens, { ...run, strike: true }, ctx, link)));
        break;
      case "codespan":
        out.push({ kind: "text", text: decode((t as Tokens.Codespan).text), props: { ...run, font: MONO, size: run.size * 0.9, shading: "#EFF1F3" }, link });
        break;
      case "br":
        out.push({ kind: "break", type: "line", props: run });
        break;
      case "link": {
        const l = t as Tokens.Link;
        const href = /^(https?:|mailto:)/i.test(l.href) ? l.href : undefined;
        out.push(...(await inlines(l.tokens, { ...run, color: LINK_COLOR, underline: "single" }, ctx, href ?? link)));
        break;
      }
      case "image": {
        const im = t as Tokens.Image;
        const image = await dataImage(im.href, ctx.width);
        if (image) out.push({ kind: "image", image, props: run, anchor: null });
        else out.push({ kind: "text", text: `[imagem: ${im.text || im.href}]`, props: { ...run, italic: true, color: "#656D76" } });
        break;
      }
      case "checkbox":
        out.push({ kind: "text", text: (t as Tokens.Checkbox).checked ? "☑ " : "☐ ", props: run });
        break;
      case "html":
        out.push({ kind: "text", text: (t as Tokens.HTML).text, props: { ...run, font: MONO, size: run.size * 0.9 } });
        break;
      default: {
        const raw = (t as { text?: string; raw?: string }).text ?? (t as { raw?: string }).raw ?? "";
        if (raw) out.push({ kind: "text", text: decode(raw), props: run, link });
      }
    }
  }
  return out;
}

/** Entidades que o `marked` deixa escapadas no texto (&amp;, &lt;, &#39;…). */
function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

const HEADING_SIZE = [20, 16, 14, 12, 11, 11];
const BULLETS = ["•", "◦", "▪"];

async function blocks(tokens: Token[], ctx: Ctx, indent: number, depth: number): Promise<Block[]> {
  const out: Block[] = [];
  const run: RunProps = { ...BASE, color: ctx.color ?? BASE.color };
  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const size = HEADING_SIZE[h.depth - 1] ?? 11;
        const hr = { ...run, bold: true, size };
        out.push(para(await inlines(h.tokens, hr, ctx), {
          indLeft: indent, spaceBefore: h.depth <= 2 ? 16 : 12, spaceAfter: 6, keepNext: true, line: 1,
          borders: h.depth <= 2 ? { bottom: RULE } : {},
        }, hr));
        break;
      }
      case "paragraph":
        out.push(para(await inlines((t as Tokens.Paragraph).tokens, run, ctx), { indLeft: indent }));
        break;
      case "text": {
        const tt = t as Tokens.Text;
        out.push(para(await inlines(tt.tokens ?? [{ type: "text", raw: tt.text, text: tt.text } as Token], run, ctx), { indLeft: indent }));
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        const mono = { ...run, font: MONO, size: 9.5, color: "#1F2328" };
        const lines = c.text.split("\n");
        const inl: Inline[] = [];
        lines.forEach((line, i) => {
          if (i) inl.push({ kind: "break", type: "line", props: mono });
          if (line) inl.push({ kind: "text", text: line, props: mono });
        });
        // Folga interna do bloco: borda da cor do fundo, com espaço até o texto.
        const pad = (space: number): Border => ({ width: 0.5, color: "#F6F8FA", style: "solid", space });
        out.push(para(inl, {
          indLeft: indent, shading: "#F6F8FA", line: 1, spaceBefore: 2, spaceAfter: 10,
          borders: { top: pad(5), bottom: pad(5), left: pad(8), right: pad(8) },
        }, mono));
        break;
      }
      case "blockquote": {
        const q = t as Tokens.Blockquote;
        const inner = await blocks(q.tokens, { ...ctx, color: "#656D76", width: ctx.width - 14 }, indent + 14, depth);
        for (const b of inner) {
          if (b.kind === "p") b.props.borders = { ...b.props.borders, left: { width: 3, color: "#D0D7DE", style: "solid", space: 8 } };
        }
        out.push(...inner);
        break;
      }
      case "list": {
        const l = t as Tokens.List;
        const step = 18;
        const at = indent + step;
        let n = typeof l.start === "number" ? l.start : 1;
        for (const item of l.items) {
          // Lista de tarefas: a caixinha, marcada ou não, no lugar do marcador.
          const label = item.task ? (item.checked ? "☑" : "☐") : l.ordered ? `${n++}.` : BULLETS[depth % BULLETS.length];
          const content = await blocks(item.tokens, { ...ctx, width: ctx.width - step }, at, depth + 1);
          const first = content.find((b): b is Paragraph => b.kind === "p");
          if (first && label) {
            first.marker = { text: label, props: run, suffix: "tab" };
            first.props.indFirst = -step;
            first.props.tabs = [{ pos: at, align: "left", leader: "none" }];
          }
          // Itens de lista apertada: pouco espaço entre eles.
          if (!l.loose) for (const b of content) if (b.kind === "p" && b.props.indLeft === at) b.props.spaceAfter = 3;
          out.push(...content);
        }
        const last = out[out.length - 1];
        if (last?.kind === "p") last.props.spaceAfter = Math.max(last.props.spaceAfter, 8);
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        const cols = tb.header.length;
        // Larguras proporcionais ao texto mais longo de cada coluna.
        const lens = Array.from({ length: cols }, (_, c) =>
          Math.max(3, tb.header[c]?.text.length ?? 0, ...tb.rows.map((r) => r[c]?.text.length ?? 0)),
        );
        const total = lens.reduce((a, b) => a + b, 0);
        const avail = ctx.width - indent;
        // Largura do conteúdo (como no GitHub), sem passar da página.
        const natural = lens.map((len) => len * 5.6 + 16);
        const sum = natural.reduce((a, b) => a + b, 0);
        const grid = sum <= avail ? natural : lens.map((len) => Math.max(36, (avail * len) / total));
        const scale = Math.min(1, avail / grid.reduce((a, b) => a + b, 0));
        const border: Border = { width: 0.75, color: "#D0D7DE", style: "solid", space: 0 };
        const cellOf = async (cell: Tokens.TableCell, header: boolean, shade: string | null) => {
          const r = header ? { ...run, bold: true } : run;
          const align = cell.align === "center" ? "center" : cell.align === "right" ? "right" : "left";
          return {
            span: 1, vMerge: null, width: null, shading: shade,
            borders: { top: border, bottom: border, left: border, right: border },
            vAlign: "top" as const, margins: { top: 3, bottom: 3, left: 5, right: 5 },
            blocks: [para(await inlines(cell.tokens, r, ctx), { align, spaceAfter: 0, line: 1.1 }, r)],
          };
        };
        const table: Table = {
          kind: "table",
          grid: grid.map((g) => g * scale),
          width: null,
          fixed: true,
          align: "left",
          indent,
          rows: [
            { height: null, heightRule: "auto", header: true, cantSplit: true, gridBefore: 0, cells: await Promise.all(tb.header.map((c) => cellOf(c, true, "#F6F8FA"))) },
            ...(await Promise.all(tb.rows.map(async (row, i) => ({
              height: null, heightRule: "auto" as const, header: false, cantSplit: true, gridBefore: 0,
              cells: await Promise.all(row.map((c) => cellOf(c, false, i % 2 ? "#F6F8FA" : null))),
            })))),
          ],
        };
        out.push(table, para([], { spaceAfter: 4, line: 0.5 }));
        break;
      }
      case "hr":
        out.push(para([], { borders: { bottom: { ...RULE, width: 1.5 } }, spaceAfter: 12, line: 0.6, indLeft: indent }));
        break;
      case "html": {
        const text = (t as Tokens.HTML).text.trim();
        if (text) out.push(para([{ kind: "text", text, props: { ...run, font: MONO, size: 9.5 } }], { indLeft: indent }));
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export async function markdownToPdf(markdown: string, options: { title?: string; onProgress?: (f: number, s: string) => void } = {}) {
  const { Lexer } = await import("marked");
  const tokens = Lexer.lex(markdown.replace(/\r\n/g, "\n"), { gfm: true });
  const body = await blocks(tokens, { width: TEXT_W, color: null }, 0, 0);
  if (!body.length) body.push(para([]));
  const model: DocModel = {
    sections: [{
      props: {
        pageWidth: PAGE_W,
        pageHeight: PAGE_H,
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 28, footer: 28, gutter: 0 },
        columns: { count: 1, space: 0, separator: false, widths: null },
        type: "nextPage",
        titlePage: false,
        headers: {},
        footers: {},
        pageNumberStart: null,
      },
      blocks: body,
    }],
    footnotes: new Map(),
    endnotes: new Map(),
    evenAndOddHeaders: false,
    defaultTab: 36,
    compatMode: 15,
    normalRun: BASE,
  };
  return modelToPdf(model, { title: options.title, onProgress: options.onProgress });
}
