import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { basicNumberFormat, fitGeneral, formatColor } from "@/lib/xlsx-to-pdf";
import { applyTint, colName, parseRange, parseRef, readWorkbook } from "@/lib/xlsx-to-pdf/read";

const ptBR = { comma: true, bool: ["VERDADEIRO", "FALSO"] as [string, string], errors: {} };

describe("referências de célula", () => {
  it("converte A1 em linha e coluna (base 0) e volta", () => {
    expect(parseRef("B3")).toEqual({ row: 2, col: 1 });
    expect(parseRef("$AA$10")).toEqual({ row: 9, col: 26 });
    expect(colName(0)).toBe("A");
    expect(colName(26)).toBe("AA");
    expect(colName(701)).toBe("ZZ");
  });

  it("lê intervalos, inclusive com nome da planilha", () => {
    expect(parseRange("'Vendas 2026'!$A$1:$F$63")).toEqual({ r1: 0, c1: 0, r2: 62, c2: 5 });
    expect(parseRange("C5")).toEqual({ r1: 4, c1: 2, r2: 4, c2: 2 });
  });
});

describe("cores do tema com variação (tint)", () => {
  it("clareia e escurece pela luminância, como o Excel", () => {
    expect(applyTint("#4472C4", 0)).toBe("#4472C4");
    expect(applyTint("#000000", 0.5)).toBe("#808080");
    expect(applyTint("#FFFFFF", -0.5)).toBe("#808080");
  });
});

describe("formatos de número", () => {
  it("formatação básica quando o SheetJS recusa o formato", () => {
    expect(basicNumberFormat("#,000", 2.5)).toBe("003");
    expect(basicNumberFormat("#,##0.00", 1234567.891)).toBe("1,234,567.89");
    expect(basicNumberFormat('"R$ "0.00', 12.5)).toBe("R$ 12.50");
    expect(basicNumberFormat("0.0%", 0.1234)).toBe("12.3%");
    expect(basicNumberFormat("0.00;(0.00)", -3)).toBe("(3.00)");
    expect(basicNumberFormat("0", -3)).toBe("-3");
  });

  it("cor da seção do formato (negativo em vermelho)", () => {
    expect(formatColor("#,##0.00;[Red]-#,##0.00", -1)).toBe("#FF0000");
    expect(formatColor("#,##0.00;[Red]-#,##0.00", 1)).toBeNull();
    expect(formatColor("[Vermelho]0", 5)).toBe("#FF0000");
  });

  it("Geral numa coluna estreita: tira casas, depois notação científica, depois desiste", () => {
    const upTo = (n: number) => (t: string) => t.length <= n;
    expect(fitGeneral(3.14159265358979, upTo(6), ptBR)).toBe("3,1416");
    expect(fitGeneral(1234567890123, upTo(8), ptBR)).toBe("1,23E+12");
    expect(fitGeneral(123456, upTo(2), ptBR)).toBeNull();
  });
});

describe("readWorkbook", () => {
  async function book(sheetXml: string, extra: { styles?: string; workbookNames?: string } = {}) {
    const zip = new JSZip();
    zip.file("xl/workbook.xml", `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan1" sheetId="1" r:id="rId1"/><sheet name="Oculta" sheetId="2" state="hidden" r:id="rId1"/></sheets>${extra.workbookNames ?? ""}</workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
    zip.file("xl/styles.xml", extra.styles ?? '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills><borders><border/><border><left style="thin"><color indexed="8"/></left><bottom style="medium"/></border></borders><cellXfs><xf fontId="0" fillId="0" borderId="0"/><xf numFmtId="4" fontId="1" fillId="2" borderId="1"><alignment horizontal="center" wrapText="1"/></xf></cellXfs></styleSheet>');
    zip.file("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Olá</t></si><si><r><t>Parte </t></r><r><rPr><b/><sz val="11"/></rPr><t>negrito</t></r></si></sst>');
    zip.file("xl/worksheets/sheet1.xml", sheetXml);
    return readWorkbook(zip);
  }

  it("lê valores, estilos, mesclagens, colunas, linhas e página", async () => {
    const wb = await book(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">
      <sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
      <sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>
      <cols><col min="1" max="2" width="12.7109375" customWidth="1"/><col min="3" max="3" width="5" hidden="1"/></cols>
      <sheetData>
        <row r="1" ht="20" customHeight="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>1234.5</v></c></row>
        <row r="3" hidden="1"><c r="A3" t="s"><v>1</v></c><c r="B3" t="b"><v>1</v></c><c r="C3" t="e"><v>#N/A</v></c></row>
      </sheetData>
      <mergeCells><mergeCell ref="A5:C6"/></mergeCells>
      <printOptions gridLines="1" horizontalCentered="1"/>
      <pageMargins left="0.5" right="0.5" top="1" bottom="1" header="0.3" footer="0.3"/>
      <pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
      <headerFooter><oddFooter>&amp;CPágina &amp;P de &amp;N</oddFooter></headerFooter>
      <rowBreaks><brk id="40" man="1"/></rowBreaks>
    </worksheet>`, { workbookNames: '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">Plan1!$1:$2</definedName></definedNames>' });
    expect(wb.sheets.map((s) => [s.name, s.hidden])).toEqual([["Plan1", false], ["Oculta", true]]);
    const s = wb.sheets[0];
    expect(s.cells.get(0)?.get(0)).toMatchObject({ type: "s", value: "Olá" });
    expect(s.cells.get(0)?.get(1)).toMatchObject({ type: "n", value: 1234.5, style: 1 });
    expect(s.cells.get(2)?.get(0)?.runs?.map((r) => [r.text, r.font.bold])).toEqual([["Parte ", false], ["negrito", true]]);
    expect(s.cells.get(2)?.get(1)).toMatchObject({ type: "b", value: true });
    expect(s.cells.get(2)?.get(2)).toMatchObject({ type: "e", value: "#N/A" });
    expect(s.rows.get(0)).toMatchObject({ height: 20, custom: true });
    expect(s.rows.get(2)?.hidden).toBe(true);
    expect(s.descent).toBe(0.25);
    expect(s.cols[1]).toMatchObject({ min: 2, max: 2, hidden: true });
    expect(s.merges).toEqual([{ r1: 4, c1: 0, r2: 5, c2: 2 }]);
    expect(s.page).toMatchObject({ orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
    expect(s.margins).toMatchObject({ left: 0.5, top: 1 });
    expect([s.gridLines, s.centerH]).toEqual([true, true]);
    expect(s.footer).toBe("&CPágina &P de &N");
    expect(s.rowBreaks).toEqual([40]);
    expect(s.printTitleRows).toEqual([0, 1]);

    const st = wb.styles[1];
    expect(st.font).toMatchObject({ name: "Arial", size: 14, bold: true, color: "#FF0000" });
    expect(st.fill).toBe("#DDEBF7");
    expect(st.border.left).toEqual({ style: "thin", color: "#000000" });
    expect(st.border.bottom?.style).toBe("medium");
    expect([st.horizontal, st.wrap, st.numFmt]).toEqual(["center", true, "#,##0.00"]);
  });
});
