import { describe, it, expect } from "vitest";
import {
  hasMsoPosition,
  isFullBleed,
  parseMsoPosition,
  resolveMsoOffset,
} from "@/lib/docx-vml-position";

/** O estilo real da forma de fundo do documento que motivou esta correção. */
const ESTILO_FUNDO =
  "position:absolute;left:0;text-align:left;margin-left:0;margin-top:0;" +
  "width:702.95pt;height:997.05pt;z-index:-251658752;" +
  "mso-position-horizontal:center;mso-position-horizontal-relative:page;" +
  "mso-position-vertical:center;mso-position-vertical-relative:page";

// A4 a 96 dpi: 210 x 297 mm.
const A4 = { width: 793.7, height: 1122.5 };
// Margens do documento: esquerda 30 mm, direita 20 mm, topo 13.2 mm.
const CONTEUDO = { left: 113.4, top: 49.9, width: 793.7 - 113.4 - 75.6, height: 1122.5 - 49.9 - 75.6 };

describe("parseMsoPosition", () => {
  it("lê alinhamento e referência do estilo real do Word", () => {
    expect(parseMsoPosition(ESTILO_FUNDO)).toEqual({
      horizontal: "center",
      horizontalRelative: "page",
      vertical: "center",
      verticalRelative: "page",
    });
  });

  it("ignora maiúsculas e espaços", () => {
    const p = parseMsoPosition("MSO-POSITION-HORIZONTAL :  RIGHT ;");
    expect(p.horizontal).toBe("right");
  });

  it("não confunde a propriedade com o sufixo -relative", () => {
    const p = parseMsoPosition("mso-position-horizontal-relative:margin");
    expect(p.horizontal).toBeUndefined();
    expect(p.horizontalRelative).toBe("margin");
  });

  it("descarta valores que não existem", () => {
    expect(parseMsoPosition("mso-position-horizontal:banana").horizontal).toBeUndefined();
  });

  it("devolve vazio para estilo sem mso", () => {
    expect(parseMsoPosition("position:absolute;left:0")).toEqual({
      horizontal: undefined,
      horizontalRelative: undefined,
      vertical: undefined,
      verticalRelative: undefined,
    });
  });
});

describe("hasMsoPosition", () => {
  it("reconhece o estilo do Word", () => {
    expect(hasMsoPosition(ESTILO_FUNDO)).toBe(true);
  });

  it("não dispara em estilo comum", () => {
    expect(hasMsoPosition("position:absolute;left:10px;width:50pt")).toBe(false);
  });
});

describe("isFullBleed", () => {
  it("reconhece a forma maior que a folha como fundo", () => {
    // 702.95pt x 997.05pt = 937 x 1329 px, maior que o A4.
    expect(isFullBleed({ width: 937, height: 1329 }, A4)).toBe(true);
  });

  it("não trata um logo como fundo", () => {
    expect(isFullBleed({ width: 275, height: 87 }, A4)).toBe(false);
  });
});

describe("resolveMsoOffset", () => {
  it("centraliza o fundo sangrado na folha, entrando em coordenada negativa", () => {
    const shape = { width: 937, height: 1329 };
    const { left, top } = resolveMsoOffset({
      mso: parseMsoPosition(ESTILO_FUNDO),
      shape,
      page: A4,
      content: CONTEUDO,
    });

    // (793.7 - 937) / 2 = -71.65 : a forma sangra igualmente pelos dois lados.
    expect(left).toBeCloseTo(-71.65, 1);
    expect(top).toBeCloseTo((A4.height - shape.height) / 2, 1);
  });

  it("não deixa o fundo começar dentro da área de texto", () => {
    // O defeito original: a forma caía na origem do conteúdo (113.4px),
    // deixando essa faixa da esquerda sem fundo nenhum.
    const { left } = resolveMsoOffset({
      mso: parseMsoPosition(ESTILO_FUNDO),
      shape: { width: 937, height: 1329 },
      page: A4,
      content: CONTEUDO,
    });

    expect(left).toBeLessThan(0);
    expect(left).not.toBeCloseTo(CONTEUDO.left, 0);
  });

  it("alinha à esquerda da folha quando pedido", () => {
    const { left } = resolveMsoOffset({
      mso: { horizontal: "left", horizontalRelative: "page" },
      shape: { width: 200, height: 100 },
      page: A4,
      content: CONTEUDO,
    });
    expect(left).toBe(0);
  });

  it("alinha à direita da folha quando pedido", () => {
    const { left } = resolveMsoOffset({
      mso: { horizontal: "right", horizontalRelative: "page" },
      shape: { width: 200, height: 100 },
      page: A4,
      content: CONTEUDO,
    });
    expect(left).toBeCloseTo(A4.width - 200, 5);
  });

  it("usa a área de conteúdo quando a referência é a margem", () => {
    const { left } = resolveMsoOffset({
      mso: { horizontal: "center", horizontalRelative: "margin" },
      shape: { width: 200, height: 100 },
      page: A4,
      content: CONTEUDO,
    });
    expect(left).toBeCloseTo(CONTEUDO.left + (CONTEUDO.width - 200) / 2, 5);
  });

  it("devolve null no eixo que o Word não alinhou", () => {
    const r = resolveMsoOffset({
      mso: { horizontal: "center", horizontalRelative: "page" },
      shape: { width: 200, height: 100 },
      page: A4,
      content: CONTEUDO,
    });
    expect(r.left).not.toBeNull();
    expect(r.top).toBeNull();
  });

  it("respeita 'absolute' sem mexer no eixo", () => {
    const r = resolveMsoOffset({
      mso: { horizontal: "absolute", horizontalRelative: "page" },
      shape: { width: 200, height: 100 },
      page: A4,
      content: CONTEUDO,
    });
    expect(r.left).toBeNull();
  });
});
