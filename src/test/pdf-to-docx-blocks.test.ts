import { describe, it, expect } from "vitest";
import { buildParagraphs } from "@/lib/pdf-to-docx/blocks";
import { groupIntoLines } from "@/lib/pdf-to-docx/lines";
import type { TextRun } from "@/lib/pdf-to-docx/types";

const BOX = { left: 85, right: 539 };

const run = (text: string, x: number, baseline: number, width: number, size = 12): TextRun => ({
  text,
  x,
  baseline,
  width,
  style: { family: "Calibri", size, bold: false, italic: false, color: { r: 0, g: 0, b: 0 } },
  artifact: false,
  endsLine: false,
  structBlock: null,
});

/** Monta parágrafos a partir de linhas descritas por (texto, x, y, largura). */
const paragraphsOf = (rows: [string, number, number, number][], size = 12) =>
  buildParagraphs(groupIntoLines(rows.map(([t, x, y, w]) => run(t, x, y, w, size))), BOX, []);

describe("buildParagraphs sem árvore de estrutura", () => {
  it("junta linhas seguidas no mesmo parágrafo e separa no vão maior", () => {
    const paragraphs = paragraphsOf([
      ["Primeira linha do parágrafo", 85, 100, 454],
      ["segunda linha do parágrafo", 85, 117, 454],
      ["Já este é outro parágrafo", 85, 151, 454],
    ]);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].lines).toHaveLength(2);
    expect(paragraphs[1].lines).toHaveLength(1);
  });

  it("reconhece centralizado, à direita e justificado", () => {
    const centralizado = paragraphsOf([["Título", 250, 100, 124]]);
    expect(centralizado[0].alignment).toBe("center");

    const direita = paragraphsOf([["São Paulo, 28 de agosto", 400, 100, 139]]);
    expect(direita[0].alignment).toBe("right");

    // Justificado: todas menos a última terminam no mesmo ponto da margem.
    const justificado = paragraphsOf([
      ["linha cheia um", 85, 100, 454],
      ["linha cheia dois", 85, 117, 454],
      ["fim curto", 85, 134, 60],
    ]);
    expect(justificado[0].alignment).toBe("justify");
  });

  it("não inventa recuo à direita numa linha curta alinhada à esquerda", () => {
    const [paragraph] = paragraphsOf([["1. Participantes:", 85, 100, 80]]);
    expect(paragraph.alignment).toBe("left");
    expect(paragraph.indentRight).toBeGreaterThan(0);
    // O valor medido existe, mas o gerador só o aplica quando é recuo de fato;
    // aqui o que importa é o alinhamento não virar "direita" nem "centro".
  });

  it("reconhece item de lista com bala e guarda a posição do marcador", () => {
    const paragraphs = paragraphsOf([
      ["•", 103, 100, 6],
      ["Equipe Amil;", 121, 100, 62],
      ["•", 103, 118, 6],
      ["Equipe LBCA;", 121, 118, 64],
    ]);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].list?.kind).toBe("bullet");
    expect(paragraphs[0].list?.marker).toBe("•");
    expect(paragraphs[0].list?.markerIndent).toBeCloseTo(18, 1);
    expect(paragraphs[0].indentLeft).toBeCloseTo(36, 1);
  });

  it("não transforma título numerado digitado à mão em lista", () => {
    // "1. Participantes" não tem recuo pendente: o texto começa colado ao
    // número. Virar lista automática faria o Word renumerar sozinho.
    const [paragraph] = paragraphsOf([["1. Participantes", 85, 100, 77]]);
    expect(paragraph.list).toBeNull();
    expect(paragraph.lines[0].text).toContain("1. Participantes");
  });

  it("não transforma travessão isolado e centralizado em lista", () => {
    const [paragraph] = paragraphsOf([["— documento gerado para teste —", 200, 100, 224]]);
    expect(paragraph.list).toBeNull();
    expect(paragraph.lines[0].text.startsWith("—")).toBe(true);
  });

  it("mede o espaço depois do parágrafo pela altura da linha seguinte", () => {
    const paragraphs = paragraphsOf([
      ["Texto", 85, 100, 40],
      ["Depois de um vão", 85, 140, 120],
    ]);

    expect(paragraphs).toHaveLength(2);
    // Vão de 40pt entre linhas de base, menos a altura de linha estimada.
    expect(paragraphs[0].spaceAfter).toBeGreaterThan(15);
    expect(paragraphs[0].spaceAfter).toBeLessThan(30);
  });
});
