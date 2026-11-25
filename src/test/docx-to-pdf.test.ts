import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { readMetrics, wordMetricsCopy } from "@/lib/docx-to-pdf/fonts";
import { paginate, type SectionLayout } from "@/lib/docx-to-pdf/paginate";
import type { Cut, FlowMetrics } from "@/lib/docx-to-pdf/measure";
import type { Paragraph, SectionProps, Table } from "@/lib/docx-to-pdf/model";
import { readDocx } from "@/lib/docx-to-pdf/parse";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"';

/** Monta um .docx mínimo em memória. */
async function docx(body: string, opts: { styles?: string; settings?: string; header?: string; sectType?: string } = {}): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  const rels = [
    '<Relationship Id="rS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
  ];
  if (opts.header) {
    rels.push('<Relationship Id="rH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>');
    zip.file("word/header1.xml", `<w:hdr ${W}>${opts.header}</w:hdr>`);
  }
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
  zip.file(
    "word/styles.xml",
    `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>${opts.styles ?? ""}</w:styles>`,
  );
  zip.file("word/settings.xml", `<w:settings ${W}>${opts.settings ?? ""}</w:settings>`);
  const sect = `<w:sectPr>${opts.header ? '<w:headerReference w:type="default" r:id="rH"/>' : ""}${opts.sectType ? `<w:type w:val="${opts.sectType}"/>` : ""}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  zip.file("word/document.xml", `<w:document ${W}><w:body>${body}${sect}</w:body></w:document>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

const font = (name: string) => {
  const b = readFileSync(resolve(__dirname, "../../public/fonts/docx", name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

describe("métricas das fontes (linha simples do Word)", () => {
  it("Calibri (Carlito): 1,2207 em, linha de base a usWinAscent", () => {
    const m = readMetrics(font("carlito-400.ttf"), "carlito");
    expect(m.lineFactor).toBeCloseTo(2500 / 2048, 4);
    expect(m.ascent).toBeCloseTo(1950 / 2048, 4);
  });

  it("Times New Roman (Liberation Serif): 1,15 em, com o line gap acima do texto", () => {
    const m = readMetrics(font("liberation-serif-400.ttf"), "liberation-serif");
    expect(m.lineFactor).toBeCloseTo((1825 + 443 + 87) / 2048, 4);
    expect(m.ascent).toBeCloseTo((1825 + 87) / 2048, 4);
  });

  it("Cambria (Caladea): usa a altura de linha da Cambria, não a da Caladea", () => {
    expect(readMetrics(font("caladea-400.ttf"), "caladea").lineFactor).toBeCloseTo((1946 + 455) / 2048, 4);
  });

  it("a cópia para o navegador iguala as três tabelas de métricas, sem mexer na original", () => {
    const original = font("liberation-sans-400.ttf");
    const before = new Uint8Array(original).slice();
    const m = readMetrics(original, "liberation-sans");
    const copy = new DataView(wordMetricsCopy(original, m));
    expect(new Uint8Array(original)).toEqual(before);
    const tables = new Map<string, number>();
    for (let i = 0; i < copy.getUint16(4); i++) {
      const rec = 12 + i * 16;
      tables.set(String.fromCharCode(...[0, 1, 2, 3].map((k) => copy.getUint8(rec + k))), copy.getUint32(rec + 8));
    }
    const hhea = tables.get("hhea")!;
    const os2 = tables.get("OS/2")!;
    const a = Math.round(m.ascent * m.unitsPerEm);
    const d = Math.round(m.descent * m.unitsPerEm);
    expect([copy.getInt16(hhea + 4), copy.getInt16(hhea + 6), copy.getInt16(hhea + 8)]).toEqual([a, -d, 0]);
    expect([copy.getInt16(os2 + 68), copy.getInt16(os2 + 70), copy.getInt16(os2 + 72)]).toEqual([a, -d, 0]);
    expect([copy.getUint16(os2 + 74), copy.getUint16(os2 + 76)]).toEqual([a, d]);
    expect(copy.getUint16(os2 + 62) & 0x80).toBe(0x80);
  });
});

// ------------------------------------------------------------- paginação

const props = (over: Partial<SectionProps> = {}): SectionProps => ({
  pageWidth: 600,
  pageHeight: 300,
  margins: { top: 50, right: 50, bottom: 50, left: 50, header: 20, footer: 20, gutter: 0 },
  columns: { count: 1, space: 36, separator: false, widths: null },
  type: "nextPage",
  titlePage: false,
  headers: {},
  footers: {},
  pageNumberStart: null,
  ...over,
});

const cut = (y: number, over: Partial<Cut> = {}): Cut => ({ y, allowed: true, fallback: true, forced: null, skip: 0, slack: 0, ...over });

function layout(flow: FlowMetrics, over: Partial<SectionProps> = {}): SectionLayout {
  return {
    index: 0,
    props: props(over),
    flow,
    flowIndex: 0,
    columnWidth: 500,
    columnLefts: [50],
    headerHeight: () => 0,
    footerHeight: () => 0,
  };
}

const noNotes = () => 0;

describe("paginate", () => {
  // Página útil: 300 - 50 - 50 = 200 pt.
  it("corta no último ponto permitido que cabe", () => {
    const flow: FlowMetrics = { height: 350, cuts: [cut(100), cut(190), cut(260), cut(350)], footnotes: [], tables: [] };
    const pages = paginate([layout(flow)], noNotes, false, true);
    expect(pages.map((p) => p.pieces.map((x) => [x.y0, x.y1]))).toEqual([[[0, 190]], [[190, 350]]]);
  });

  it("não corta onde deixaria linha viúva ou órfã, se houver outro ponto", () => {
    const flow: FlowMetrics = { height: 300, cuts: [cut(150), cut(195, { allowed: false }), cut(300)], footnotes: [], tables: [] };
    const pages = paginate([layout(flow)], noNotes, false, true);
    expect(pages[0].pieces[0].y1).toBe(150);
  });

  it("quebra de página obrigatória vem antes de tudo", () => {
    const flow: FlowMetrics = { height: 120, cuts: [cut(40, { forced: "page" }), cut(80), cut(120)], footnotes: [], tables: [] };
    const pages = paginate([layout(flow)], noNotes, false, true);
    expect(pages).toHaveLength(2);
    expect(pages[0].pieces[0].y1).toBe(40);
  });

  it("o espaço antes some no alto da página: na quebra natural sempre; na manual, só no Word 2013+", () => {
    const flow: FlowMetrics = { height: 120, cuts: [cut(40, { forced: "page", skip: 18 }), cut(120)], footnotes: [], tables: [] };
    expect(paginate([layout(flow)], noNotes, false, true)[1].pieces[0].y0).toBe(58);
    expect(paginate([layout(flow)], noNotes, false, false)[1].pieces[0].y0).toBe(40);
  });

  it("reserva o espaço das notas de rodapé chamadas na página", () => {
    const flow: FlowMetrics = { height: 300, cuts: [cut(120), cut(170), cut(300)], footnotes: [{ y: 60, id: "1" }], tables: [] };
    const pages = paginate([layout(flow)], (ids) => (ids.length ? 50 : 0), false, true);
    // 200 de página útil - 50 da nota: o corte em 170 já não cabe.
    expect(pages[0].pieces[0].y1).toBe(120);
    expect(pages[0].footnotes).toEqual(["1"]);
  });

  it("o espaço depois do parágrafo pode passar do pé da página", () => {
    const flow: FlowMetrics = { height: 300, cuts: [cut(150), cut(208, { slack: 10 }), cut(300)], footnotes: [], tables: [] };
    expect(paginate([layout(flow)], noNotes, false, true)[0].pieces[0].y1).toBe(208);
  });

  it("repete o cabeçalho da tabela na página seguinte", () => {
    const flow: FlowMetrics = {
      height: 400,
      cuts: [cut(20), cut(120), cut(190), cut(260), cut(330), cut(400)],
      footnotes: [],
      tables: [{ top: 0, bottom: 400, header: { top: 0, bottom: 20 } }],
    };
    const pages = paginate([layout(flow)], noNotes, false, true);
    expect(pages[1].pieces[0]).toMatchObject({ y0: 0, y1: 20, y: 50 });
    expect(pages[1].pieces[1]).toMatchObject({ y0: 190, y: 70 });
  });

  it("página de rosto e numeração inicial da seção", () => {
    const flow: FlowMetrics = { height: 300, cuts: [cut(190), cut(300)], footnotes: [], tables: [] };
    const pages = paginate([layout(flow, { titlePage: true, pageNumberStart: 5 })], noNotes, false, true);
    expect(pages.map((p) => [p.number, p.running])).toEqual([[5, "first"], [6, "default"]]);
  });
});

// ------------------------------------------------------------- leitura

const firstParagraphs = (blocks: unknown[]) => blocks.filter((b): b is Paragraph => (b as Paragraph).kind === "p");

describe("readDocx", () => {
  it("modo de compatibilidade: o do arquivo, ou o do Word 2007 quando não diz", async () => {
    const v15 = await readDocx(await docx("<w:p/>", {
      settings: '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>',
    }));
    expect(v15.compatMode).toBe(15);
    expect((await readDocx(await docx("<w:p/>"))).compatMode).toBe(12);
  });

  it("tabulação gravada como caractere vira tabulação", async () => {
    const m = await readDocx(await docx('<w:p><w:r><w:t xml:space="preserve">Cargo\t2021</w:t></w:r></w:p>'));
    expect(firstParagraphs(m.sections[0].blocks)[0].inlines.map((i) => i.kind)).toEqual(["text", "tab", "text"]);
  });

  it("campo PAGE inteiro num trecho só, sem resultado gravado", async () => {
    const m = await readDocx(await docx(
      '<w:p><w:r><w:t xml:space="preserve">Página </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    ));
    const inlines = firstParagraphs(m.sections[0].blocks)[0].inlines;
    expect(inlines.map((i) => i.kind)).toEqual(["text", "field"]);
    expect(inlines[1]).toMatchObject({ field: "PAGE" });
  });

  it("quebra de página no fim do parágrafo leva o próximo bloco para a página seguinte", async () => {
    const m = await readDocx(await docx('<w:p><w:r><w:t>Capa</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:r><w:t>Corpo</w:t></w:r></w:p>'));
    const ps = firstParagraphs(m.sections[0].blocks);
    expect(ps.map((p) => [p.breakOnly ?? false, p.props.pageBreakBefore])).toEqual([[false, false], [true, true], [false, false]]);
  });

  it("parágrafo vazio da quebra de seção contínua não ocupa linha", async () => {
    const m = await readDocx(await docx(
      '<w:p><w:r><w:t>Título</w:t></w:r></w:p><w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr></w:p><w:p><w:r><w:t>Texto</w:t></w:r></w:p>',
      { sectType: "continuous" },
    ));
    expect(m.sections).toHaveLength(2);
    expect(m.sections[0].blocks).toHaveLength(1);
  });

  it("documento que termina em tabela ganha o parágrafo final que o Word acrescenta", async () => {
    const m = await readDocx(await docx('<w:tbl><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'));
    expect(m.sections[0].blocks.map((b) => b.kind)).toEqual(["table", "p"]);
  });

  it("tabela: largura em porcentagem, layout e margem padrão da célula", async () => {
    const tbl = (tblPr: string) =>
      `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid><w:gridCol w:w="100"/></w:tblGrid><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p/>`;
    const semEstilo = await readDocx(await docx(tbl('<w:tblW w:type="pct" w:w="100%"/>')));
    const t1 = semEstilo.sections[0].blocks[0] as Table;
    expect(t1.width).toEqual({ type: "pct", value: 100 });
    expect(t1.fixed).toBe(false);
    expect(t1.rows[0].cells[0].margins.left).toBeCloseTo(0.5);

    const comEstilo = await readDocx(await docx(tbl('<w:tblW w:type="pct" w:w="5000"/><w:tblLayout w:type="fixed"/>'), {
      styles: '<w:style w:type="table" w:default="1" w:styleId="TabelaNormal"><w:tblPr><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>',
    }));
    const t2 = comEstilo.sections[0].blocks[0] as Table;
    expect(t2.width).toEqual({ type: "pct", value: 100 });
    expect(t2.fixed).toBe(true);
    expect(t2.rows[0].cells[0].margins.left).toBeCloseTo(5.4);
  });

  it("cor da borda vem de w:color", async () => {
    const m = await readDocx(await docx('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="1F4E79"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'));
    expect(firstParagraphs(m.sections[0].blocks)[0].props.borders.bottom).toMatchObject({ color: "#1F4E79", width: 0.75, space: 4 });
  });

  it("notas de fim: chamada no texto e conteúdo, separados das notas de rodapé", async () => {
    const buf = await docx('<w:p><w:r><w:t>Texto</w:t></w:r><w:r><w:endnoteReference w:id="1"/></w:r></w:p>');
    const zip = await JSZip.loadAsync(buf);
    zip.file("word/endnotes.xml", `<w:endnotes ${W}><w:endnote w:type="separator" w:id="-1"><w:p/></w:endnote><w:endnote w:id="1"><w:p><w:r><w:endnoteRef/></w:r><w:r><w:t>Nota.</w:t></w:r></w:p></w:endnote></w:endnotes>`);
    const rels = (await zip.file("word/_rels/document.xml.rels")!.async("string")).replace(
      "</Relationships>",
      '<Relationship Id="rE" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/></Relationships>',
    );
    zip.file("word/_rels/document.xml.rels", rels);
    const m = await readDocx(await zip.generateAsync({ type: "arraybuffer" }));
    expect(firstParagraphs(m.sections[0].blocks)[0].inlines[1]).toMatchObject({ kind: "footnote", id: "e1" });
    expect([...m.endnotes.keys()]).toEqual(["e1"]);
    expect(m.footnotes.size).toBe(0);
    expect((m.endnotes.get("e1")![0] as Paragraph).inlines[0]).toMatchObject({ kind: "footnote", id: "self" });
  });

  it("marca d'água de texto do VML", async () => {
    const header =
      '<w:p><w:r><w:pict><v:shapetype id="t136"><v:textpath on="t" fitshape="t"/></v:shapetype>' +
      '<v:shape type="#t136" style="position:absolute;width:500pt;height:120pt;rotation:315;z-index:-1;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin" fillcolor="silver" stroked="f">' +
      '<v:fill opacity=".5"/><v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" string="CONFIDENCIAL"/></v:shape></w:pict></w:r></w:p>';
    const m = await readDocx(await docx("<w:p/>", { header }));
    const box = (m.sections[0].props.headers.default![0] as Paragraph).inlines[0];
    expect(box).toMatchObject({
      kind: "box",
      width: 500,
      height: 120,
      watermark: { text: "CONFIDENCIAL", font: "Calibri", color: "#C0C0C0", opacity: 0.5, rotation: 315 },
      anchor: { hAlign: "center", vAlign: "center", behind: true },
    });
  });
});

describe("formato do número de página", () => {
  it("lê o formato pedido no campo PAGE", async () => {
    const { fieldFormat } = await import("@/lib/docx-to-pdf/parse");
    expect(fieldFormat(" PAGE \\* roman \\* MERGEFORMAT ")).toBe("lowerRoman");
    expect(fieldFormat("PAGE \\* ROMAN")).toBe("upperRoman");
    expect(fieldFormat("PAGE \\* alphabetic")).toBe("lowerLetter");
    expect(fieldFormat("PAGE \\* MERGEFORMAT")).toBeUndefined();
    expect(fieldFormat("PAGE")).toBeUndefined();
  });
});
