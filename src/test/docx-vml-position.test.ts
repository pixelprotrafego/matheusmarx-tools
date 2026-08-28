import { describe, it, expect } from "vitest";
import {
  hasMsoPosition,
  isFullBleed,
  parseMsoPosition,
  resolveMsoOffset,
} from "@/lib/docx-vml-position";

/**
 * O estilo real da forma de fundo, copiado do que o Chromium reportou ao
 * renderizar o documento (veja `scripts/diagnostico-docx.mjs`). Repare que a
 * referência é a caixa de *margens*, não a folha, e que não há `left`.
 */
const ESTILO_FUNDO =
  "position:absolute;margin-left:0;margin-top:0;" +
  "width:702.95pt;height:997.05pt;z-index:-251656704;" +
  "mso-position-horizontal:center;mso-position-horizontal-relative:margin;" +
  "mso-position-vertical:center;mso-position-vertical-relative:margin";

// Geometria medida no navegador para este documento.
const A4 = { width: 793.7, height: 1122.5 };
const CONTEUDO = { left: 113.4, top: 50.07, width: 604.7, height: 996.83 };
const FORMA = { width: 937.3, height: 1329.4 };

describe("parseMsoPosition", () => {
  it("lê alinhamento e referência do estilo real do Word", () => {
    expect(parseMsoPosition(ESTILO_FUNDO)).toEqual({
      horizontal: "center",
      horizontalRelative: "margin",
      vertical: "center",
      verticalRelative: "margin",
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
  it("centraliza o fundo na caixa de margens, como o Word", () => {
    const { left, top } = resolveMsoOffset({
      mso: parseMsoPosition(ESTILO_FUNDO),
      shape: FORMA,
      page: A4,
      content: CONTEUDO,
    });

    // 113.4 + (604.7 - 937.3) / 2 = -52.9 : sangra pelos dois lados.
    expect(left).toBeCloseTo(-52.9, 1);
    // 50.07 + (996.83 - 1329.4) / 2 = -116.2
    expect(top).toBeCloseTo(-116.2, 1);
  });

  it("corrige as duas posições erradas que o navegador produz sozinho", () => {
    const { left } = resolveMsoOffset({
      mso: parseMsoPosition(ESTILO_FUNDO),
      shape: FORMA,
      page: A4,
      content: CONTEUDO,
    });

    // Página 1 caía em x=0 (o VML trazia `left:0`) e página 2 em x=113.4
    // (sem `left`, o absoluto assume a posição estática, dentro do header).
    expect(left).not.toBeCloseTo(0, 0);
    expect(left).not.toBeCloseTo(CONTEUDO.left, 0);
    expect(left).toBeLessThan(0);
  });

  it("não centraliza na folha quando o Word pediu a caixa de margens", () => {
    // Erro de uma tentativa anterior: forçar "page" dava -71.65 em vez de -52.9.
    const { left } = resolveMsoOffset({
      mso: parseMsoPosition(ESTILO_FUNDO),
      shape: FORMA,
      page: A4,
      content: CONTEUDO,
    });
    expect(left).not.toBeCloseTo((A4.width - FORMA.width) / 2, 1);
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
