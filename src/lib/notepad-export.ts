import { saveAs } from "file-saver";
import type { Editor } from "@tiptap/react";
import type { ExternalHyperlink, IRunOptions, Paragraph as DocxParagraph, TextRun as DocxTextRun } from "docx";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Um nó do documento JSON do TipTap, na forma em que este módulo o percorre. */
export interface TipTapNode {
  type?: string;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
}

export function toTxt(editor: Editor, filename = "nota.txt") {
  const blob = new Blob([editor.getText()], { type: "text/plain;charset=utf-8" });
  saveAs(blob, filename);
}

export async function toHtml(editor: Editor, filename = "nota.html") {
  const DOMPurify = (await import("dompurify")).default;
  const body = DOMPurify.sanitize(editor.getHTML());
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${filename}</title></head><body>${body}</body></html>`;
  saveAs(new Blob([html], { type: "text/html;charset=utf-8" }), filename);
}

export async function toMd(editor: Editor, filename = "nota.md") {
  const TurndownService = (await import("turndown")).default;
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  const md = td.turndown(editor.getHTML());
  saveAs(new Blob([md], { type: "text/markdown;charset=utf-8" }), filename);
}

/**
 * PDF com texto de verdade, montado a partir do mesmo .docx da exportação
 * para Word, pelo motor de Word para PDF do site.
 *
 * A versão anterior fotografava a tela (html2canvas) e fatiava a foto em
 * páginas: o texto não era selecionável, a página cortava uma linha ao meio e,
 * como o editor usa tema escuro, o texto claro saía quase invisível no fundo
 * branco do PDF.
 */
export async function toPdf(editor: Editor, filename = "nota.pdf") {
  const blob = await buildDocx(editor.getJSON() as TipTapNode);
  const { docxToPdf } = await import("./docx-to-pdf");
  const { bytes } = await docxToPdf(await blob.arrayBuffer());
  saveAs(new Blob([bytes.slice().buffer], { type: "application/pdf" }), filename);
}

export async function toDocx(editor: Editor, filename = "nota.docx") {
  saveAs(await buildDocx(editor.getJSON() as TipTapNode), filename);
}

// ------------------------------------------------------------ tradução p/ docx

/** Fontes que o Word (e o motor de PDF) conhecem; o resto cai no genérico. */
const KNOWN_FONTS = new Set([
  "arial", "times new roman", "courier new", "georgia", "verdana", "calibri", "cambria",
  "segoe ui", "tahoma", "trebuchet ms", "garamond", "helvetica",
]);
const GENERIC_FONT: Record<string, string> = { serif: "Times New Roman", monospace: "Courier New", "sans-serif": "Arial" };

/**
 * Família CSS ("Inter, system-ui, sans-serif") para uma fonte de documento:
 * a primeira que o Word tem, ou a do genérico da lista. Gravar "Inter" no
 * .docx fazia o Word trocar por uma fonte qualquer.
 */
export function docxFont(css: string): string {
  const families = css.split(",").map((f) => f.trim().replace(/^['"]|['"]$/g, ""));
  const known = families.find((f) => KNOWN_FONTS.has(f.toLowerCase()));
  if (known) return known;
  const generic = families.find((f) => GENERIC_FONT[f.toLowerCase()]);
  return generic ? GENERIC_FONT[generic.toLowerCase()] : "Arial";
}

/** Cor CSS (#abc, #aabbcc, rgb(...)) em hexadecimal de 6 dígitos, ou nada. */
export function docxColor(css: unknown): string | undefined {
  const s = String(css ?? "").trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return `${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return undefined;
}

/** Tamanho CSS ("16px", "12pt") em meios-pontos, a unidade do Word. */
export function docxSize(css: unknown): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(String(css ?? "").trim());
  if (!m) return undefined;
  const pt = m[2] === "px" ? (+m[1] * 72) / 96 : +m[1];
  return Math.round(pt * 2);
}

/**
 * O documento do editor como .docx.
 *
 * A versão anterior perdia blocos de código, quebras de linha (Shift+Enter),
 * sublistas, a marca das listas de tarefa, alinhamento, tamanho de fonte e
 * realce; e a lista numerada apontava para uma numeração que não existia no
 * arquivo, então o Word mostrava os itens sem número.
 */
export async function buildDocx(json: TipTapNode): Promise<Blob> {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType, LevelFormat, ShadingType, BorderStyle } = d;
  const paragraphs: DocxParagraph[] = [];
  const numberings: { reference: string; start: number }[] = [];

  const ALIGN = {
    left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
  } as const;
  const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 } as const;

  const runs = (nodes: TipTapNode[] | undefined, extra: { font?: string } = {}): (DocxTextRun | ExternalHyperlink)[] =>
    (nodes ?? []).map((node) => {
      if (node.type === "hardBreak") return new TextRun({ break: 1 });
      let link: string | undefined;
      const o: Mutable<IRunOptions> = { text: node.text ?? "", ...extra };
      for (const m of node.marks ?? []) {
        const a = m.attrs ?? {};
        if (m.type === "bold") o.bold = true;
        else if (m.type === "italic") o.italics = true;
        else if (m.type === "underline") o.underline = {};
        else if (m.type === "strike") o.strike = true;
        else if (m.type === "code") {
          o.font = "Courier New";
          o.shading = { type: ShadingType.CLEAR, color: "auto", fill: "F0F0F0" };
        } else if (m.type === "textStyle") {
          const color = docxColor(a.color);
          if (color) o.color = color;
          if (a.fontFamily) o.font = docxFont(String(a.fontFamily));
          const size = docxSize(a.fontSize);
          if (size) o.size = size;
        } else if (m.type === "highlight") {
          o.shading = { type: ShadingType.CLEAR, color: "auto", fill: docxColor(a.color) ?? "FFFF00" };
        } else if (m.type === "link" && typeof a.href === "string" && /^(https?:|mailto:)/i.test(a.href)) {
          link = a.href;
        }
      }
      if (link) {
        // Azul e sublinhado, como o Word mostra link.
        o.color = o.color ?? "0563C1";
        o.underline = {};
        return new ExternalHyperlink({ link, children: [new TextRun(o)] });
      }
      return new TextRun(o);
    });

  const alignment = (node: TipTapNode) => ALIGN[(node.attrs?.textAlign as keyof typeof ALIGN) ?? "left"];

  /** Blocos de um nível; `list` diz em que lista o bloco está, se estiver. */
  const blocks = (
    nodes: TipTapNode[] | undefined,
    ctx: { level: number; list?: { reference?: string; bullet?: boolean; mark?: string }; quote?: boolean } = { level: 0 },
  ) => {
    for (const node of nodes ?? []) {
      const indentQuote = ctx.quote ? { left: 720 } : undefined;
      switch (node.type) {
        case "heading":
          paragraphs.push(new Paragraph({
            heading: HEADING[(node.attrs?.level as 1 | 2 | 3) ?? 1] ?? HeadingLevel.HEADING_1,
            alignment: alignment(node),
            children: runs(node.content),
          }));
          break;
        case "paragraph": {
          const list = ctx.list;
          const children = runs(node.content);
          if (list?.mark) children.unshift(new TextRun(list.mark));
          paragraphs.push(new Paragraph({
            alignment: alignment(node),
            children,
            ...(list?.bullet ? { bullet: { level: ctx.level } } : {}),
            ...(list?.reference ? { numbering: { reference: list.reference, level: ctx.level } } : {}),
            // Segundo parágrafo do mesmo item: recuado, sem marcador novo.
            ...(list && !list.bullet && !list.reference ? { indent: { left: 720 * (ctx.level + 1) } } : {}),
            ...(!list && indentQuote ? { indent: indentQuote } : {}),
          }));
          if (list) ctx = { ...ctx, list: { ...list, bullet: false, reference: undefined, mark: undefined } };
          break;
        }
        case "bulletList":
        case "orderedList":
        case "taskList": {
          let reference: string | undefined;
          if (node.type === "orderedList") {
            reference = `lista-${numberings.length + 1}`;
            numberings.push({ reference, start: Number(node.attrs?.start ?? 1) || 1 });
          }
          const level = ctx.list ? ctx.level + 1 : ctx.level;
          for (const item of node.content ?? []) {
            const mark = node.type === "taskList" ? (item.attrs?.checked ? "☑ " : "☐ ") : undefined;
            blocks(item.content, {
              level,
              quote: ctx.quote,
              list: { bullet: node.type === "bulletList", reference, mark },
            });
          }
          break;
        }
        case "codeBlock":
          // Uma linha do código por parágrafo, em fonte fixa, com fundo.
          for (const line of (node.content ?? []).map((t) => t.text ?? "").join("").split("\n")) {
            paragraphs.push(new Paragraph({
              shading: { type: ShadingType.CLEAR, color: "auto", fill: "F3F3F3" },
              spacing: { before: 0, after: 0 },
              children: [new TextRun({ text: line, font: "Courier New", size: 20 })],
            }));
          }
          break;
        case "blockquote":
          blocks(node.content, { ...ctx, quote: true });
          break;
        case "horizontalRule":
          paragraphs.push(new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
            children: [],
          }));
          break;
        default:
          blocks(node.content, ctx);
      }
    }
  };

  blocks(json.content);
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [new TextRun("")] }));

  const doc = new Document({
    // Corpo em 12 pt (os 16 px do editor), em fonte que o Word tem.
    // e 6 pt entre parágrafos, como o editor mostra.
    styles: { default: { document: { run: { font: "Arial", size: 24 }, paragraph: { spacing: { after: 120 } } } } },
    numbering: {
      config: numberings.map(({ reference, start }) => ({
        reference,
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          start: level === 0 ? start : 1,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      })),
    },
    sections: [{ children: paragraphs }],
  });
  return Packer.toBlob(doc);
}
