import { describe, expect, it } from "vitest";
import { isAllPages, parsePageOrder, parsePageRange, parsePageSelection } from "@/lib/page-range";

describe("parsePageRange", () => {
  it("aceita páginas soltas e faixas, sem repetir e em ordem", () => {
    expect(parsePageRange("3-1, 5, 5, 9", 6)).toEqual([0, 1, 2, 4]);
  });

  it("recusa o que não é número nem faixa, em vez de ignorar em silêncio", () => {
    expect(() => parsePageRange("abc", 6)).toThrow(/Intervalo inválido/);
    expect(() => parsePageRange("1-3,x", 6)).toThrow(/"x"/);
  });

  it("não trata 0 como página 1", () => {
    expect(() => parsePageRange("0", 6)).toThrow(/Nenhuma página/);
  });

  it("faixa gigante não percorre o intervalo inteiro", () => {
    const inicio = performance.now();
    expect(parsePageRange("1-999999999", 3)).toEqual([0, 1, 2]);
    expect(performance.now() - inicio).toBeLessThan(50);
  });
});

describe("parsePageSelection", () => {
  it("all, todas e vazio são o documento inteiro", () => {
    for (const s of ["all", "Todas", "", "  "]) expect(parsePageSelection(s, 3)).toEqual([0, 1, 2]);
    expect(isAllPages("tudo")).toBe(true);
    expect(parsePageSelection("2", 3)).toEqual([1]);
  });
});

describe("parsePageOrder", () => {
  it("respeita a ordem digitada e permite repetir", () => {
    expect(parsePageOrder("3,1,1,2", 3)).toEqual([2, 0, 0, 1]);
  });

  it("faixa decrescente inverte as páginas", () => {
    expect(parsePageOrder("4-1", 4)).toEqual([3, 2, 1, 0]);
  });

  it("página inexistente é erro, não sumiço", () => {
    expect(() => parsePageOrder("1,7", 6)).toThrow(/página 7 não existe/);
  });
});
