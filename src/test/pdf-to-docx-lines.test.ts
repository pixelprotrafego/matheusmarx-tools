import { describe, it, expect } from "vitest";
import { groupIntoLines } from "@/lib/pdf-to-docx/lines";
import type { TextRun } from "@/lib/pdf-to-docx/types";

const style = (over: Partial<TextRun["style"]> = {}): TextRun["style"] => ({
  family: "Calibri",
  size: 12,
  bold: false,
  italic: false,
  color: { r: 0, g: 0, b: 0 },
  ...over,
});

const run = (text: string, x: number, baseline: number, width: number, over: Partial<TextRun> = {}): TextRun => ({
  text,
  x,
  baseline,
  width,
  style: style(over.style),
  artifact: false,
  endsLine: false,
  structBlock: null,
  ...over,
});

describe("groupIntoLines", () => {
  it("junta na mesma linha os trechos com a mesma linha de base", () => {
    const lines = groupIntoLines([
      run("Bom", 50, 100, 20),
      run("dia", 74, 100, 18),
      run("Outra", 50, 120, 30),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("Bom dia");
    expect(lines[1].text).toBe("Outra");
  });

  it("repõe o espaço pela distância, sem duplicar o que já existe", () => {
    const semEspaco = groupIntoLines([run("Bom", 50, 100, 20), run("dia", 74, 100, 18)]);
    expect(semEspaco[0].text).toBe("Bom dia");

    const comEspaco = groupIntoLines([run("Bom ", 50, 100, 24), run("dia", 74, 100, 18)]);
    expect(comEspaco[0].text).toBe("Bom dia");
  });

  it("mantém o expoente na linha do texto que o carrega", () => {
    const lines = groupIntoLines([
      run("x", 50, 100, 8),
      run("2", 58, 96, 5, { style: style({ size: 8 }) }),
      run(" + 1", 63, 100, 20),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0].runs.find((r) => r.text === "2")?.vertical).toBe("superscript");
  });

  it("não funde trechos separados por um vão largo", () => {
    // É a divisa entre duas colunas de tabela: fundir os dois lados apagaria
    // a fronteira e a fileira inteira cairia numa célula só.
    const lines = groupIntoLines([run("CP-01", 70, 100, 28), run("100,2", 150, 100, 26)]);

    expect(lines[0].runs).toHaveLength(2);
    expect(lines[0].runs[0].text).toBe("CP-01");
    expect(lines[0].text).toBe("CP-01 100,2");
  });

  it("ignora o trecho de espaço em branco que o pdf.js usa para vencer o vão", () => {
    const lines = groupIntoLines([
      run("CP-01", 70, 100, 28),
      run(" ", 98, 100, 52),
      run("100,2", 150, 100, 26),
    ]);

    expect(lines[0].runs).toHaveLength(2);
    expect(lines[0].right).toBeCloseTo(176, 1);
  });

  it("descarta a linha que só tem espaço em branco", () => {
    expect(groupIntoLines([run("   ", 50, 100, 30)])).toHaveLength(0);
  });
});
