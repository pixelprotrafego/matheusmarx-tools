import { describe, expect, it } from "vitest";
import { findGutters, partitionPage } from "@/lib/pdf-to-docx/layout";
import { groupIntoLines } from "@/lib/pdf-to-docx/lines";
import { buildParagraphs, measureLeading } from "@/lib/pdf-to-docx/blocks";
import { extractFootnotes } from "@/lib/pdf-to-docx/footnotes";
import { estimateRightEdge } from "@/lib/pdf-to-docx/sections";
import { applyRuleDecorations, buildRuledTable, detectRuledGrids } from "@/lib/pdf-to-docx/tables";
import type { RuleSegment, TextRun } from "@/lib/pdf-to-docx/types";

const black = { r: 0, g: 0, b: 0 };
const run = (text: string, x: number, baseline: number, width: number, size = 10, over: Partial<TextRun> = {}): TextRun => ({
  text, x, baseline, width,
  style: { family: "Calibri", size, bold: false, italic: false, color: black },
  artifact: false, endsLine: false, structBlock: null,
  ...over,
});
const h = (position: number, from: number, to: number, thickness = 0.5): RuleSegment => ({
  axis: "h", position, from, to, thickness, color: black, filled: true,
});
const v = (position: number, from: number, to: number): RuleSegment => ({
  axis: "v", position, from, to, thickness: 0.5, color: black, filled: true,
});

/** Duas colunas de texto com as linhas na mesma altura. */
const twoColumns = () => {
  const runs: TextRun[] = [];
  for (let i = 0; i < 8; i++) {
    runs.push(run(`coluna um linha ${i}`, 60, 100 + i * 12, 200));
    runs.push(run(`coluna dois linha ${i}`, 300, 100 + i * 12, 200));
  }
  return runs;
};

describe("colunas", () => {
  it("acha o rio entre duas colunas e não mistura as linhas", () => {
    const runs = twoColumns();
    const gutters = findGutters(runs);
    expect(gutters).toHaveLength(1);
    expect(gutters[0].x0).toBeGreaterThanOrEqual(259);
    expect(gutters[0].x1).toBeLessThanOrEqual(301);
    const lines = groupIntoLines(runs, { gutters });
    expect(lines.every((l) => !/um.*dois/.test(l.text))).toBe(true);
    const [segment] = partitionPage(lines, gutters);
    expect(segment.kind).toBe("columns");
  });

  it("não separa a bala do texto de uma lista", () => {
    const runs: TextRun[] = [];
    for (let i = 0; i < 6; i++) {
      runs.push(run("•", 60, 100 + i * 12, 4));
      runs.push(run(`item número ${i} da lista`, 78, 100 + i * 12, 150));
    }
    expect(findGutters(runs)).toHaveLength(0);
  });

  it("um vão vertical grande encerra a coluna", () => {
    // Data à direita, bem acima de duas assinaturas lado a lado.
    const runs = [
      run("Fortaleza, 24 de novembro de 2026.", 330, 100, 200),
      run("______________", 80, 160, 150), run("______________", 330, 160, 150),
      run("ACME LTDA.", 110, 172, 80), run("JOÃO PEREIRA", 360, 172, 90),
      run("Contratada", 120, 184, 60), run("Contratante", 370, 184, 60),
    ];
    const gutters = findGutters(runs);
    expect(gutters.every((g) => g.top > 110)).toBe(true);
  });

  it("borda de célula impede a fusão de textos vizinhos", () => {
    const lines = groupIntoLines([run("R$ 1038,50", 600, 100, 66), run("22/12/2026", 672, 100, 40)], {
      barriers: [{ x: 671, top: 90, bottom: 104 }],
    });
    expect(lines.map((l) => l.text)).toEqual(["R$ 1038,50", "22/12/2026"]);
  });
});

describe("parágrafos", () => {
  it("a entrelinha é o menor salto que se repete, e não a mediana", () => {
    const lines = groupIntoLines([
      run("MBA em Finanças Corporativas — Universidade", 60, 100, 300),
      run("Bacharelado em Ciências Contábeis — UECE", 60, 116, 300),
      run("(2016)", 60, 128, 30),
      run("Outro item com duas", 60, 144, 300),
      run("linhas dentro dele", 60, 156, 90),
      run("mais um", 60, 172, 60),
    ]);
    expect(measureLeading(lines)).toBeCloseTo(12, 0);
  });

  it("linhas curtas centralizadas de uma capa são parágrafos separados", () => {
    const box = { left: 85, right: 539 };
    const lines = groupIntoLines([
      run("UNIVERSIDADE ESTADUAL DO CEARÁ", 222, 100, 180, 12),
      run("CENTRO DE ESTUDOS SOCIAIS", 236, 114, 152, 12),
      run("CURSO DE ADMINISTRAÇÃO", 245, 128, 134, 12),
    ]);
    expect(buildParagraphs(lines, box, [])).toHaveLength(3);
  });

  it("título em negrito não gruda no parágrafo seguinte", () => {
    const bold = (t: string, x: number, y: number, w: number) =>
      run(t, x, y, w, 12, { style: { family: "Times", size: 12, bold: true, italic: false, color: black } });
    const lines = groupIntoLines([
      bold("CLÁUSULA PRIMEIRA — DO OBJETO", 85, 100, 200),
      run("A presente cláusula estabelece as condições gerais de prestação", 120, 120, 419, 12),
      run("dos serviços, que serão executados com zelo.", 85, 140, 260, 12),
    ]);
    const paragraphs = buildParagraphs(lines, { left: 85, right: 539 }, []);
    expect(paragraphs[0].lines.map((l) => l.text)).toEqual(["CLÁUSULA PRIMEIRA — DO OBJETO"]);
  });
});

describe("largura da área de texto", () => {
  it("vem das quebras de linha, e não da linha mais comprida", () => {
    // Texto alinhado à esquerda: a margem real (500) fica entre o fim das
    // linhas e o fim que teriam com a primeira palavra da linha seguinte.
    const lines = groupIntoLines([
      run("primeira linha bem comprida do parágrafo", 60, 100, 420),
      run("segundalinha começa com palavra longa", 60, 112, 400),
      run("terceira linha também comprida aqui", 60, 124, 425),
      run("quartapalavra e o resto", 60, 136, 200),
    ]);
    const edge = estimateRightEdge(lines, 520);
    expect(edge).toBeGreaterThan(485);
  });

  it("havendo texto justificado, a borda é onde ele termina", () => {
    const lines = groupIntoLines([0, 1, 2, 3].map((i) => run("linha justificada inteira", 60, 100 + i * 12, 440)));
    expect(estimateRightEdge(lines, 540)).toBeCloseTo(500, 0);
  });
});

describe("notas de rodapé", () => {
  it("separa a nota e marca a chamada elevada no corpo", () => {
    const body = groupIntoLines([
      run("A receita cresceu 2,2% no período", 60, 100, 200),
      run("1", 261, 96, 4, 7),
      run("1", 60, 760, 4, 7),
      run("Comparado ao trimestre anterior.", 66, 762, 150, 9),
    ]);
    let id = 0;
    const { body: rest, notes } = extractFootnotes(body, [h(750, 60, 200)], { left: 60, right: 535 }, 842, () => ++id);
    expect(notes).toHaveLength(1);
    expect(notes[0].lines[0].text.trim()).toBe("Comparado ao trimestre anterior.");
    expect(rest).toHaveLength(1);
    expect(rest[0].runs.some((r) => r.footnote === 1)).toBe(true);
  });

  it("sem a chamada no corpo, o texto fica onde estava", () => {
    const body = groupIntoLines([run("Texto comum", 60, 100, 100), run("1 Nota sem chamada", 60, 760, 120, 9)]);
    const result = extractFootnotes(body, [h(750, 60, 200)], { left: 60, right: 535 }, 842, () => 1);
    expect(result.notes).toHaveLength(0);
    expect(result.body).toHaveLength(2);
  });
});

describe("tabela com grade", () => {
  it("borda desenhada em pedaços não vira mescla, e a falta dela vira", () => {
    // Linha 1: uma célula mesclada sobre as duas colunas; linha 2: duas células.
    // A borda horizontal do meio vem em dois pedaços, como o Word desenha.
    const rules = [
      h(400, 60, 220), h(400, 220, 380), h(430, 60, 220), h(430, 220, 380), h(460, 60, 220), h(460, 220, 380),
      v(60, 400, 460), v(380, 400, 460), v(220, 430, 460),
    ];
    const [grid] = detectRuledGrids(rules);
    const lines = groupIntoLines([run("Observações", 70, 420, 60), run("a", 70, 450, 5), run("b", 230, 450, 5)]);
    const { table } = buildRuledTable(grid, lines, rules, [], (ls, box) => buildParagraphs(ls, box, []));
    expect(table.rows[0].cells).toHaveLength(1);
    expect(table.rows[0].cells[0].span).toBe(2);
    expect(table.rows[0].cells[0].rowSpan).toBe(1);
    expect(table.rows[1].cells).toHaveLength(2);
    expect(table.rows[0].height).toBeCloseTo(30, 0);
  });
});

describe("decorações", () => {
  it("um trecho com uma palavra sublinhada e outra tachada recebe as duas", () => {
    const lines = groupIntoLines([run(", sublinhado, tachado e mais", 100, 200, 280, 12)]);
    applyRuleDecorations(lines, [h(201.2, 120, 220, 0.7), h(196, 230, 300, 0.7)]);
    expect(lines[0].runs.some((r) => r.underline)).toBe(true);
    expect(lines[0].runs.some((r) => r.strike)).toBe(true);
  });
});
