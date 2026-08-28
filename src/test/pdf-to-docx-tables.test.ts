import { describe, it, expect } from "vitest";
import { applyRuleDecorations, buildRuledTable, detectRuledGrids } from "@/lib/pdf-to-docx/tables";
import { groupIntoLines, type TextLine } from "@/lib/pdf-to-docx/lines";
import { buildParagraphs } from "@/lib/pdf-to-docx/blocks";
import type { RuleSegment, TextRun } from "@/lib/pdf-to-docx/types";

const black = { r: 0, g: 0, b: 0 };

const h = (position: number, from: number, to: number): RuleSegment => ({
  axis: "h", position, from, to, thickness: 0.75, color: black, filled: true,
});
const v = (position: number, from: number, to: number): RuleSegment => ({
  axis: "v", position, from, to, thickness: 0.75, color: black, filled: true,
});

const run = (text: string, x: number, baseline: number, width: number): TextRun => ({
  text, x, baseline, width,
  style: { family: "Calibri", size: 11, bold: false, italic: false, color: black },
  artifact: false, endsLine: false, structBlock: null,
});

/** Grade de 2 colunas por 2 linhas, entre x=60..380 e y=400..460. */
const grade = (): RuleSegment[] => [
  h(400, 60, 380), h(430, 60, 380), h(460, 60, 380),
  v(60, 400, 460), v(220, 400, 460), v(380, 400, 460),
];

describe("detectRuledGrids", () => {
  it("reconhece uma grade fechada", () => {
    const [grid] = detectRuledGrids(grade());
    expect(grid.columns).toEqual([60, 220, 380]);
    expect(grid.rows).toEqual([400, 430, 460]);
  });

  it("ignora um filete solto, que não é tabela", () => {
    expect(detectRuledGrids([h(200, 60, 380)])).toEqual([]);
    expect(detectRuledGrids([h(200, 60, 380), h(300, 60, 380)])).toEqual([]);
  });

  it("separa duas tabelas distantes na mesma página", () => {
    const segunda = grade().map((r) =>
      r.axis === "h"
        ? { ...r, position: r.position + 300 }
        : { ...r, from: r.from + 300, to: r.to + 300 },
    );
    const grids = detectRuledGrids([...grade(), ...segunda]);
    expect(grids).toHaveLength(2);
    expect(grids[0].top).toBe(400);
    expect(grids[1].top).toBe(700);
  });
});

describe("buildRuledTable", () => {
  it("distribui por coluna os trechos de uma fileira", () => {
    // Os quatro valores estão na mesma linha de base: sem recorte por coluna,
    // a fileira inteira cairia numa célula só.
    const lines = groupIntoLines([
      run("Amostra", 70, 420, 45),
      run("Carga", 230, 420, 32),
      run("CP-01", 70, 450, 28),
      run("245,8", 230, 450, 28),
    ]);

    const [grid] = detectRuledGrids(grade());
    const { table, used } = buildRuledTable(grid, lines, grade(), [], (cellLines, box) =>
      buildParagraphs(cellLines, box, []),
    );

    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].cells.map((c) => c.paragraphs[0]?.lines[0].text)).toEqual(["Amostra", "Carga"]);
    expect(table.rows[1].cells.map((c) => c.paragraphs[0]?.lines[0].text)).toEqual(["CP-01", "245,8"]);
    expect(used.size).toBe(lines.length);
  });
});

describe("applyRuleDecorations", () => {
  const linhaCom = (texto: string, x: number, largura: number): TextLine[] =>
    groupIntoLines([run(texto, x, 100, largura)]);

  it("sublinha só o pedaço coberto pelo filete", () => {
    const lines = linhaCom("um trecho sublinhado aqui", 100, 200);
    // O filete cobre da metade do trecho até três quartos dele.
    applyRuleDecorations(lines, [h(101.5, 124, 200)]);

    const sublinhados = lines[0].runs.filter((r) => r.underline);
    expect(sublinhados.length).toBeGreaterThan(0);
    expect(lines[0].runs.length).toBeGreaterThan(1);
    // O texto da linha continua inteiro depois do corte.
    expect(lines[0].runs.map((r) => r.text).join("")).toBe("um trecho sublinhado aqui");
  });

  it("não confunde a borda de uma tabela com sublinhado", () => {
    const lines = linhaCom("texto qualquer", 100, 100);
    // Filete bem abaixo da linha de base: é borda, não sublinhado.
    applyRuleDecorations(lines, [h(112, 100, 200)]);

    expect(lines[0].runs.some((r) => r.underline)).toBe(false);
  });
});
