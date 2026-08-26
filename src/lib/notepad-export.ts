import { saveAs } from "file-saver";
import type { Editor } from "@tiptap/react";

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

export async function toPdf(el: HTMLElement, filename = "nota.pdf") {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const canvas = await html2canvas(el, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
  });
  const img = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const ratio = canvas.width / canvas.height;
  const imgW = pageW - 48;
  const imgH = imgW / ratio;
  let y = 24;
  let remaining = imgH;
  // single image, paginated by slicing if needed
  if (imgH <= pageH - 48) {
    pdf.addImage(img, "PNG", 24, y, imgW, imgH);
  } else {
    // simple paginate: draw scaled, then add pages with negative offsets
    let position = 0;
    while (remaining > 0) {
      pdf.addImage(img, "PNG", 24, 24 - position, imgW, imgH);
      remaining -= pageH - 48;
      position += pageH - 48;
      if (remaining > 0) pdf.addPage();
    }
  }
  pdf.save(filename);
}

export async function toDocx(editor: Editor, filename = "nota.docx") {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const json = editor.getJSON();
  const paragraphs: any[] = [];

  const runFromText = (node: any): any => {
    const marks: any = {};
    for (const m of node.marks ?? []) {
      if (m.type === "bold") marks.bold = true;
      if (m.type === "italic") marks.italics = true;
      if (m.type === "underline") marks.underline = {};
      if (m.type === "strike") marks.strike = true;
      if (m.type === "code") marks.font = "Courier New";
      if (m.type === "textStyle") {
        if (m.attrs?.color) marks.color = String(m.attrs.color).replace("#", "");
        if (m.attrs?.fontFamily) marks.font = m.attrs.fontFamily;
      }
    }
    return new TextRun({ text: node.text ?? "", ...marks });
  };

  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "heading") {
      const lvl = node.attrs?.level ?? 1;
      const headingMap: Record<number, any> = {
        1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
      };
      paragraphs.push(new Paragraph({
        heading: headingMap[lvl] ?? HeadingLevel.HEADING_1,
        children: (node.content ?? []).map(runFromText),
      }));
      return;
    }
    if (node.type === "paragraph") {
      paragraphs.push(new Paragraph({ children: (node.content ?? []).map(runFromText) }));
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList") {
      for (const li of node.content ?? []) {
        for (const child of li.content ?? []) {
          paragraphs.push(new Paragraph({
            bullet: node.type === "bulletList" ? { level: 0 } : undefined,
            numbering: node.type === "orderedList" ? { reference: "num", level: 0 } : undefined,
            children: (child.content ?? []).map(runFromText),
          }));
        }
      }
      return;
    }
    if (node.type === "blockquote") {
      for (const child of node.content ?? []) walk(child);
      return;
    }
    if (node.content) for (const c of node.content) walk(c);
  };

  for (const node of json.content ?? []) walk(node);
  if (!paragraphs.length) paragraphs.push(new Paragraph({ children: [new TextRun("")] }));

  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}