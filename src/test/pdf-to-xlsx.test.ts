import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { columnBands, detectDecimalComma, parseValue } from "@/lib/pdf-to-xlsx";
import { columnLetter, sheetNames, writeXlsx } from "@/lib/xlsx-writer";

describe("parseValue (vírgula decimal)", () => {
  const v = (t: string) => parseValue(t, true);

  it("números com milhar, decimais e sinal", () => {
    expect(v("1.234,56")).toEqual({ value: 1234.56, format: "#,##0.00" });
    expect(v("12")).toEqual({ value: 12, format: "General" });
    expect(v("-3,5")).toEqual({ value: -3.5, format: "0.0" });
    expect(v("(1.000,00)")).toEqual({ value: -1000, format: "#,##0.00;(#,##0.00)" });
    expect(v("150,00-")?.value).toBe(-150);
  });

  it("moeda e porcentagem", () => {
    expect(v("R$ 1.234,50")).toEqual({ value: 1234.5, format: '"R$ "#,##0.00' });
    expect(v("-R$ 10,00")?.value).toBe(-10);
    expect(v("12,5%")).toEqual({ value: 0.125, format: "0.0%" });
    expect(v("+2,3%")).toEqual({ value: 0.023, format: "+0.0%;-0.0%" });
  });

  it("datas válidas viram data; inválidas continuam texto", () => {
    expect(v("31/12/2026")).toEqual({ value: 46387, format: "dd/mm/yyyy" });
    expect(v("01/02/26")?.format).toBe("dd/mm/yy");
    expect(v("31/02/2026")).toBeNull();
  });

  it("identificadores continuam texto", () => {
    expect(v("0123")).toBeNull(); // zero à esquerda
    expect(v("123.456.789-00")).toBeNull(); // CPF
    expect(v("60000-000")).toBeNull(); // CEP
    expect(v("1234567890123456")).toBeNull(); // mais de 15 dígitos
    expect(v("P-001")).toBeNull();
    expect(v("Total")).toBeNull();
  });

  it("documento com ponto decimal", () => {
    expect(parseValue("1,234.56", false)).toEqual({ value: 1234.56, format: "#,##0.00" });
    expect(parseValue("12/31/2026", false)?.value).toBe(46387);
  });
});

describe("detectDecimalComma", () => {
  it("vota pelos números que só um jeito explica", () => {
    expect(detectDecimalComma(["1.234,56", "10,50", "Total"])).toBe(true);
    expect(detectDecimalComma(["1,234.56", "10.50", "Total"])).toBe(false);
    expect(detectDecimalComma(["Sem números"])).toBe(true);
  });
});

describe("columnBands", () => {
  const seg = (left: number, right: number) => ({ text: "x", left, right, bold: false, size: 10, color: { r: 0, g: 0, b: 0 } });

  it("acha as colunas pelos vãos e parte a faixa de um título largo", () => {
    const lines = [
      [seg(10, 60), seg(100, 140), seg(200, 240)],
      [seg(10, 50), seg(110, 140), seg(190, 240)],
      // Cabeçalho que cobre as duas primeiras colunas, e outro pedaço na mesma linha.
      [seg(10, 150), seg(200, 230)],
    ];
    const bands = columnBands(lines);
    expect(bands.length).toBe(3);
    expect(bands[2].left).toBeGreaterThanOrEqual(150);
  });

  it("sem linha com mais de um pedaço, não há colunas", () => {
    expect(columnBands([[seg(0, 300)], [seg(0, 280)]])).toEqual([]);
  });
});

describe("writeXlsx", () => {
  it("grava valores, estilos, formatos, mesclagem e larguras que o leitor entende", async () => {
    const bytes = await writeXlsx([
      {
        name: "Vendas: 2026/1",
        rows: [
          [{ value: "Produto", style: { bold: true, fill: "#1F4E79", color: "#FFFFFF", border: true } }, { value: "Total", style: { bold: true } }],
          [{ value: "Caneta & cia <x>" }, { value: 1234.5, style: { numFmt: '"R$ "#,##0.00' } }],
          [{ value: 46387, style: { numFmt: "dd/mm/yyyy" } }, { value: true }],
        ],
        colWidths: [20, 12],
        merges: [{ r1: 3, c1: 0, r2: 3, c2: 1 }],
      },
      { name: "Vendas: 2026/1", rows: [[{ value: "segunda" }]] },
    ]);
    const wb = XLSX.read(bytes, { cellStyles: true, cellNF: true });
    expect(wb.SheetNames).toEqual(["Vendas  2026 1", "Vendas  2026 1 (2)"]);
    const ws = wb.Sheets[wb.SheetNames[0]];
    expect(ws.A2.v).toBe("Caneta & cia <x>");
    expect(ws.B2).toMatchObject({ t: "n", v: 1234.5, z: '"R$ "#,##0.00' });
    expect(ws.A3.z).toBe("dd/mm/yyyy");
    expect(ws.B3).toMatchObject({ t: "b", v: true });
    expect(ws["!merges"]).toEqual([{ s: { r: 3, c: 0 }, e: { r: 3, c: 1 } }]);
    expect(ws["!cols"]?.[0]?.width).toBe(20);
  });

  it("nomes e letras de coluna", () => {
    expect(sheetNames(["a", "A", "x".repeat(40)])).toEqual(["a", "A (2)", "x".repeat(31)]);
    expect([columnLetter(0), columnLetter(25), columnLetter(26), columnLetter(27)]).toEqual(["A", "Z", "AA", "AB"]);
  });
});
