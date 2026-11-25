import { describe, it, expect } from "vitest";
import { parseSvgDimensions, rasterReason, svgLength } from "@/lib/svg-utils";

describe("svgLength", () => {
  it("converte unidades para pixels CSS (96 por polegada)", () => {
    expect(svgLength("100")).toBe(100);
    expect(svgLength("100px")).toBe(100);
    expect(svgLength("72pt")).toBe(96);
    expect(svgLength("1in")).toBe(96);
    expect(svgLength("25.4mm")).toBeCloseTo(96);
    expect(svgLength("2.54cm")).toBeCloseTo(96);
  });

  it("porcentagem e lixo não são medida", () => {
    expect(svgLength("100%")).toBeNull();
    expect(svgLength("auto")).toBeNull();
    expect(svgLength(null)).toBeNull();
  });
});

describe("parseSvgDimensions", () => {
  const svg = (attrs: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}></svg>`;

  it("usa largura e altura com unidade", () => {
    const d = parseSvgDimensions(svg('width="210mm" height="297mm"'));
    expect(d.width).toBeCloseTo(793.7, 1);
    expect(d.height).toBeCloseTo(1122.5, 1);
  });

  it("sem medida, usa a caixa de visão; com uma só, mantém a proporção", () => {
    expect(parseSvgDimensions(svg('viewBox="0 0 400 200"'))).toEqual({ width: 400, height: 200 });
    expect(parseSvgDimensions(svg('width="100%" height="100%" viewBox="0 0 400 200"'))).toEqual({ width: 400, height: 200 });
    expect(parseSvgDimensions(svg('width="800" viewBox="0 0 400 200"'))).toEqual({ width: 800, height: 400 });
  });
});

describe("rasterReason", () => {
  const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${inner}</svg>`;

  it("formas e texto vão vetoriais", () => {
    expect(rasterReason(svg('<rect width="5" height="5"/><text x="1" y="9">Olá</text>'))).toBeNull();
  });

  it("filtro, HTML embutido e imagem de fora vão como imagem", () => {
    expect(rasterReason(svg('<filter id="f"><feGaussianBlur stdDeviation="2"/></filter><rect filter="url(#f)" width="5" height="5"/>'))).toBe("filtro");
    expect(rasterReason(svg('<foreignObject width="5" height="5"/>'))).toBe("html embutido");
    expect(rasterReason(svg('<image href="https://exemplo.com/a.png" width="5" height="5"/>'))).toBe("imagem externa");
  });
});
