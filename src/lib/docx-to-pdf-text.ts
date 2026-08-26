import DOMPurify from "dompurify";

type Style = { bold?: boolean; italic?: boolean; size?: number; heading?: number };

const PAGE = { w: 210, h: 297, mx: 18, my: 18 };

/**
 * Converte DOCX -> PDF com TEXTO SELECIONÁVEL real (sem rasterização).
 * Perde imagens/marca d'água/layout — use apenas quando o usuário quer texto.
 */
export async function docxToPdfText(
  arrayBuffer: ArrayBuffer,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  const mammoth = await import("mammoth");
  const { value: rawHtml } = await mammoth.convertToHtml({ arrayBuffer });
  onProgress?.(40);

  const clean = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "style"],
  });
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, "text/html");
  const root = doc.body.firstElementChild as HTMLElement;

  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  pdf.setFont("helvetica", "normal");

  let y = PAGE.my;
  const maxY = PAGE.h - PAGE.my;
  const maxW = PAGE.w - PAGE.mx * 2;

  const newPageIfNeeded = (lineH: number) => {
    if (y + lineH > maxY) { pdf.addPage(); y = PAGE.my; }
  };

  const setFontFor = (st: Style) => {
    const size = st.size ?? (st.heading ? [22, 18, 16, 14, 12, 11][st.heading - 1] || 11 : 11);
    const style = st.bold && st.italic ? "bolditalic" : st.bold ? "bold" : st.italic ? "italic" : "normal";
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    return size;
  };

  const writeParagraph = (text: string, st: Style, opts: { bullet?: boolean; indent?: number } = {}) => {
    if (!text.trim()) { y += 3; return; }
    const size = setFontFor(st);
    const lineH = size * 0.42;
    const indent = opts.indent ?? 0;
    const prefix = opts.bullet ? "•  " : "";
    const w = maxW - indent;
    const lines = pdf.splitTextToSize(prefix + text.replace(/\s+/g, " ").trim(), w);
    for (const line of lines) {
      newPageIfNeeded(lineH);
      pdf.text(line, PAGE.mx + indent, y + lineH * 0.8);
      y += lineH;
    }
    y += st.heading ? 3 : 1.5;
  };

  const inheritFromTag = (tag: string, st: Style): Style => {
    switch (tag) {
      case "STRONG": case "B": return { ...st, bold: true };
      case "EM": case "I": return { ...st, italic: true };
      case "H1": return { ...st, bold: true, heading: 1 };
      case "H2": return { ...st, bold: true, heading: 2 };
      case "H3": return { ...st, bold: true, heading: 3 };
      case "H4": return { ...st, bold: true, heading: 4 };
      case "H5": case "H6": return { ...st, bold: true, heading: 5 };
      default: return st;
    }
  };

  const collectText = (el: Node, st: Style): { text: string; st: Style } => {
    if (el.nodeType === Node.TEXT_NODE) return { text: (el as Text).data, st };
    let out = "";
    let curSt = st;
    if (el.nodeType === Node.ELEMENT_NODE) {
      const tag = (el as HTMLElement).tagName;
      curSt = inheritFromTag(tag, st);
      el.childNodes.forEach((c) => { out += collectText(c, curSt).text; });
    }
    return { text: out, st: curSt };
  };

  const walk = (node: Element, indent = 0) => {
    const tag = node.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const lvl = parseInt(tag[1], 10);
      const { text } = collectText(node, { bold: true, heading: lvl });
      writeParagraph(text, { bold: true, heading: lvl }, { indent });
      return;
    }
    if (tag === "P") {
      const { text } = collectText(node, {});
      writeParagraph(text, {}, { indent });
      return;
    }
    if (tag === "UL" || tag === "OL") {
      Array.from(node.children).forEach((li, i) => {
        const { text } = collectText(li, {});
        const prefix = tag === "OL" ? `${i + 1}. ` : "";
        writeParagraph(prefix + text, {}, { bullet: tag === "UL", indent: indent + 4 });
      });
      return;
    }
    if (tag === "TABLE") {
      const rows = Array.from(node.querySelectorAll("tr"));
      rows.forEach((tr) => {
        const cells = Array.from(tr.children).map((c) => collectText(c, {}).text.replace(/\s+/g, " ").trim());
        writeParagraph(cells.join("   |   "), { size: 10 }, { indent });
      });
      y += 2;
      return;
    }
    Array.from(node.children).forEach((c) => walk(c as Element, indent));
  };

  Array.from(root.children).forEach((c) => walk(c as Element));
  onProgress?.(90);

  return pdf.output("blob");
}
