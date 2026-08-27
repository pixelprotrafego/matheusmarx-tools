import { describe, it, expect } from "vitest";
import {
  CONVERSION_GRAPH,
  FORMATS,
  GROUPS,
  SOURCE_FORMATS,
  detectFormat,
  formatMeta,
  targetsFor,
  type FormatKey,
} from "@/lib/convert-formats";

describe("detectFormat", () => {
  it("reconhece documentos pela extensão", () => {
    expect(detectFormat("contrato.docx")).toBe("docx");
    expect(detectFormat("relatorio.pdf")).toBe("pdf");
    expect(detectFormat("planilha.xlsx")).toBe("xlsx");
    expect(detectFormat("planilha antiga.xls")).toBe("xlsx");
  });

  it("reconhece imagens pela extensão", () => {
    expect(detectFormat("foto.jpg")).toBe("image");
    expect(detectFormat("foto.jpeg")).toBe("image");
    expect(detectFormat("print.png")).toBe("image");
    expect(detectFormat("icone.svg")).toBe("svg");
    expect(detectFormat("animado.gif")).toBe("gif");
    expect(detectFormat("iphone.heic")).toBe("heic");
    expect(detectFormat("iphone.HEIF")).toBe("heic");
  });

  it("não confunde JFIF com JPEG comum", () => {
    expect(detectFormat("imagem.jfif")).toBe("jfif");
    expect(detectFormat("imagem.jpg")).toBe("image");
  });

  it("ignora maiúsculas e caminhos com ponto no nome", () => {
    expect(detectFormat("RELATORIO.PDF")).toBe("pdf");
    expect(detectFormat("versao.2.final.docx")).toBe("docx");
  });

  it("usa o MIME quando a extensão não ajuda", () => {
    expect(detectFormat("arquivo-sem-extensao", "application/pdf")).toBe("pdf");
    expect(detectFormat("download", "image/webp")).toBe("webp");
  });

  it("prefere a extensão ao MIME quando os dois discordam", () => {
    // Windows costuma reportar HEIC como octet-stream ou até como jpeg.
    expect(detectFormat("foto.heic", "image/jpeg")).toBe("heic");
  });

  it("devolve null para o que não sabe converter", () => {
    expect(detectFormat("arquivo.xyz")).toBeNull();
    expect(detectFormat("sem-extensao")).toBeNull();
    expect(detectFormat("")).toBeNull();
  });
});

describe("catálogo de formatos", () => {
  it("não tem chave duplicada", () => {
    const keys = FORMATS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("não tem extensão registrada em dois formatos", () => {
    const all = FORMATS.flatMap((f) => f.extensions);
    expect(new Set(all).size).toBe(all.length);
  });

  it("usa extensões em minúsculas e com ponto", () => {
    for (const f of FORMATS) {
      for (const ext of f.extensions) {
        expect(ext).toBe(ext.toLowerCase());
        expect(ext.startsWith(".")).toBe(true);
      }
    }
  });

  it("coloca todo formato em um grupo existente", () => {
    const groups = new Set(GROUPS.map((g) => g.key));
    for (const f of FORMATS) {
      expect(groups.has(f.group)).toBe(true);
    }
  });
});

describe("grafo de conversões", () => {
  const entries = Object.entries(CONVERSION_GRAPH) as [FormatKey, readonly FormatKey[]][];

  it("toda origem existe no catálogo", () => {
    for (const [from] of entries) {
      expect(formatMeta(from), `origem sem metadados: ${from}`).toBeDefined();
    }
  });

  it("todo destino existe no catálogo", () => {
    for (const [from, tos] of entries) {
      for (const to of tos) {
        expect(formatMeta(to), `destino sem metadados: ${from} -> ${to}`).toBeDefined();
      }
    }
  });

  it("nenhuma conversão aponta para o próprio formato", () => {
    for (const [from, tos] of entries) {
      expect(tos).not.toContain(from);
    }
  });

  it("nenhuma origem repete o mesmo destino", () => {
    for (const [, tos] of entries) {
      expect(new Set(tos).size).toBe(tos.length);
    }
  });

  it("SOURCE_FORMATS lista exatamente quem tem destino", () => {
    for (const key of SOURCE_FORMATS) {
      expect(targetsFor(key).length).toBeGreaterThan(0);
    }
    expect(SOURCE_FORMATS).not.toContain("mp4");
    expect(SOURCE_FORMATS).not.toContain("ico");
  });

  it("targetsFor devolve lista vazia para entrada desconhecida", () => {
    expect(targetsFor(null)).toEqual([]);
    expect(targetsFor("mp4")).toEqual([]);
  });
});
