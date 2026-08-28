import { describe, it, expect } from "vitest";
import { parseFontName } from "@/lib/pdf-to-docx/fonts";

describe("parseFontName", () => {
  it("descarta o prefixo de subconjunto e o sufixo PostScript", () => {
    expect(parseFontName("BCDEEE+ArialMT")).toEqual({ family: "Arial", bold: false, italic: false });
    expect(parseFontName("BCDFEE+TimesNewRomanPSMT")).toEqual({
      family: "Times New Roman",
      bold: false,
      italic: false,
    });
  });

  it("lê o estilo colado ao nome com hífen", () => {
    expect(parseFontName("BCDHEE+Calibri-Bold")).toEqual({ family: "Calibri", bold: true, italic: false });
    expect(parseFontName("TimesNewRomanPS-BoldItalicMT")).toEqual({
      family: "Times New Roman",
      bold: true,
      italic: true,
    });
    expect(parseFontName("Arial-ItalicMT")).toEqual({ family: "Arial", bold: false, italic: true });
  });

  it("lê o estilo depois da vírgula, como o Word grava", () => {
    // A família precisa sobreviver inteira: "Aptos SemiBold" é uma família que
    // o Word conhece, e reduzi-la a "Aptos" trocaria o desenho da letra.
    expect(parseFontName("BCDGEE+Aptos SemiBold,Bold")).toEqual({
      family: "Aptos SemiBold",
      bold: true,
      italic: false,
    });
    expect(parseFontName("Georgia,BoldItalic")).toEqual({ family: "Georgia", bold: true, italic: true });
  });

  it("não confunde variação de família com estilo", () => {
    expect(parseFontName("ArialNarrow")).toEqual({ family: "Arial Narrow", bold: false, italic: false });
    expect(parseFontName("Arial Bold")).toEqual({ family: "Arial", bold: true, italic: false });
  });

  it("troca as fontes base do PDF pelas equivalentes instaladas", () => {
    expect(parseFontName("Helvetica").family).toBe("Arial");
    expect(parseFontName("Helvetica-Bold")).toEqual({ family: "Arial", bold: true, italic: false });
    expect(parseFontName("Courier").family).toBe("Courier New");
    expect(parseFontName("BCDKEE+SymbolMT").family).toBe("Symbol");
  });

  it("cai na família genérica quando o PDF não embutiu a fonte", () => {
    expect(parseFontName(null, "serif").family).toBe("Times New Roman");
    expect(parseFontName("", "sans-serif").family).toBe("Arial");
    expect(parseFontName(undefined, "monospace").family).toBe("Courier New");
  });
});
