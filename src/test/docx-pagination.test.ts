import { describe, it, expect } from "vitest";
import { planSlices, type Block } from "@/lib/docx-pagination";

/** Gera blocos empilhados de altura fixa, como parágrafos de um documento. */
const stack = (count: number, height: number, gap = 0): Block[] =>
  Array.from({ length: count }, (_, i) => ({
    top: i * (height + gap),
    bottom: i * (height + gap) + height,
  }));

const totalHeight = (blocks: Block[]) => blocks[blocks.length - 1].bottom;

describe("planSlices", () => {
  it("não fatia quando o conteúdo cabe em uma página", () => {
    const blocks = stack(5, 20); // 100px
    const slices = planSlices(blocks, 100, 1000);

    expect(slices).toEqual([{ top: 0, height: 100 }]);
  });

  it("não fatia por diferença de subpixel", () => {
    const blocks = stack(1, 1002);
    const slices = planSlices(blocks, 1002, 1000);

    expect(slices).toHaveLength(1);
  });

  it("fatia um documento longo em várias páginas", () => {
    const blocks = stack(150, 20); // 3000px
    const slices = planSlices(blocks, totalHeight(blocks), 1000);

    expect(slices.length).toBeGreaterThan(1);
    expect(slices[0].top).toBe(0);
  });

  it("corta na borda de um bloco, nunca no meio dele", () => {
    const blocks = stack(30, 70); // 2100px, blocos de 70
    const slices = planSlices(blocks, totalHeight(blocks), 500);

    const bordas = new Set<number>([0, ...blocks.map((b) => b.bottom)]);
    for (const s of slices) {
      expect(bordas.has(s.top)).toBe(true);
    }
  });

  it("cobre o conteúdo inteiro, sem buraco e sem sobreposição", () => {
    const blocks = stack(37, 45);
    const content = totalHeight(blocks);
    const slices = planSlices(blocks, content, 400);

    expect(slices[0].top).toBe(0);
    for (let i = 1; i < slices.length; i++) {
      expect(slices[i].top).toBe(slices[i - 1].top + slices[i - 1].height);
    }
    const last = slices[slices.length - 1];
    expect(last.top + last.height).toBe(content);
  });

  it("nenhuma fatia passa da altura da página", () => {
    const blocks = stack(60, 33);
    const slices = planSlices(blocks, totalHeight(blocks), 300);

    for (const s of slices) {
      expect(s.height).toBeLessThanOrEqual(300);
    }
  });

  it("corta na altura cheia quando um bloco é maior que a página", () => {
    // Uma imagem de 2500px numa página de 1000px: não há borda utilizável.
    const blocks: Block[] = [{ top: 0, bottom: 2500 }];
    const slices = planSlices(blocks, 2500, 1000);

    expect(slices).toEqual([
      { top: 0, height: 1000 },
      { top: 1000, height: 1000 },
      { top: 2000, height: 500 },
    ]);
  });

  it("funciona sem nenhum bloco mapeado", () => {
    const slices = planSlices([], 2500, 1000);

    expect(slices).toHaveLength(3);
    expect(slices[2]).toEqual({ top: 2000, height: 500 });
  });

  it("nao entra em laço infinito com valores degenerados", () => {
    expect(planSlices([], 1000, 0)).toHaveLength(1);
    expect(planSlices([], 0, 1000)).toHaveLength(1);
  });
});
