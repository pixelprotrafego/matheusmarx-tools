import { describe, it, expect } from "vitest";
import { chaveData, domingoDePascoa, feriadosNacionais, noRecesso } from "@/lib/advocacia/feriados";
import { calcularPrazo, type OpcoesPrazo } from "@/lib/advocacia/prazos";

const base: Omit<OpcoesPrazo, "publicacao" | "dias" | "regime"> = {
  suspenderRecesso: true,
  incluirForenses: false,
  incluirCarnavalCorpusChristi: true,
  personalizados: [],
};

const uteis = (publicacao: string, dias: number, extra: Partial<OpcoesPrazo> = {}) =>
  calcularPrazo({ ...base, regime: "uteis", publicacao, dias, ...extra });

describe("Páscoa e feriados móveis", () => {
  it("acerta as datas conhecidas da Páscoa", () => {
    expect(chaveData(domingoDePascoa(2024))).toBe("2024-03-31");
    expect(chaveData(domingoDePascoa(2025))).toBe("2025-04-20");
  });

  it("sempre cai num domingo", () => {
    for (let ano = 2020; ano <= 2040; ano++) {
      expect(domingoDePascoa(ano).getDay()).toBe(0);
    }
  });

  it("traz a Sexta-feira Santa dois dias antes da Páscoa", () => {
    const nomes = feriadosNacionais(2025);
    expect(nomes.find((f) => f.nome === "Sexta-feira Santa")?.data).toBe("2025-04-18");
  });

  it("inclui a Consciência Negra só a partir de 2024", () => {
    expect(feriadosNacionais(2023).some((f) => f.data === "2023-11-20")).toBe(false);
    expect(feriadosNacionais(2024).some((f) => f.data === "2024-11-20")).toBe(true);
  });
});

describe("recesso de 20/12 a 20/01", () => {
  it("reconhece as bordas", () => {
    expect(noRecesso(new Date(2025, 11, 19))).toBe(false);
    expect(noRecesso(new Date(2025, 11, 20))).toBe(true);
    expect(noRecesso(new Date(2026, 0, 20))).toBe(true);
    expect(noRecesso(new Date(2026, 0, 21))).toBe(false);
  });
});

describe("contagem em dias úteis", () => {
  it("exclui o dia da publicação e começa no dia útil seguinte", () => {
    // 2025-05-05 é uma segunda-feira: a contagem começa na terça.
    const r = uteis("2025-05-05", 5);
    expect(r.ok).toBe(true);
    expect(r.inicio).toBe("2025-05-06");
    expect(r.vencimento).toBe("2025-05-12");
  });

  it("publicação na sexta faz a contagem começar na segunda", () => {
    // 2025-05-09 é sexta; sábado e domingo não contam.
    const r = uteis("2025-05-09", 1);
    expect(r.inicio).toBe("2025-05-12");
    expect(r.vencimento).toBe("2025-05-12");
  });

  it("pula feriado nacional no meio da contagem", () => {
    // 1º de maio de 2025 é quinta-feira. Publicando na segunda 28/04, a
    // contagem vai 29, 30, pula o feriado, e retoma na sexta 02/05.
    const r = uteis("2025-04-28", 3);
    expect(r.vencimento).toBe("2025-05-02");
    expect(r.trilha?.some((d) => d.data === "2025-05-01" && d.motivo === "feriado")).toBe(true);
  });

  it("suspende no recesso e retoma em 21 de janeiro", () => {
    const r = uteis("2025-12-17", 5);
    expect(r.ok).toBe(true);
    // 18 e 19 de dezembro contam; o resto atravessa o recesso.
    expect(r.vencimento?.startsWith("2026-01-2")).toBe(true);
    expect(r.trilha?.some((d) => d.motivo === "recesso")).toBe(true);
  });

  it("conta exatamente o número de dias pedido", () => {
    for (const dias of [1, 5, 15, 30]) {
      const r = uteis("2025-03-10", dias);
      expect(r.trilha?.filter((d) => d.numero !== null)).toHaveLength(dias);
      expect(r.trilha?.find((d) => d.numero === dias)?.data).toBe(r.vencimento);
    }
  });

  it("nunca vence em fim de semana ou feriado", () => {
    for (let dia = 1; dia <= 28; dia++) {
      const publicacao = `2025-09-${String(dia).padStart(2, "0")}`;
      const r = uteis(publicacao, 15);
      const vencimento = new Date(`${r.vencimento}T12:00:00`);
      expect([0, 6]).not.toContain(vencimento.getDay());
    }
  });
});

describe("contagem em dias corridos", () => {
  const corridos = (publicacao: string, dias: number) =>
    calcularPrazo({ ...base, suspenderRecesso: false, regime: "corridos", publicacao, dias });

  it("conta sábado e domingo", () => {
    // Quinta 2025-05-08 + 5 dias corridos = terça 2025-05-13.
    const r = corridos("2025-05-08", 5);
    expect(r.vencimento).toBe("2025-05-13");
  });

  it("prorroga o vencimento que cai em dia sem expediente", () => {
    // Segunda 2025-05-05 + 5 corridos cairia no sábado 10/05; vai para segunda.
    const r = corridos("2025-05-05", 5);
    expect(r.vencimentoOriginal).toBe("2025-05-10");
    expect(r.prorrogado).toBe(true);
    expect(r.vencimento).toBe("2025-05-12");
  });
});

describe("feriados personalizados", () => {
  it("respeita a data cadastrada por quem usa", () => {
    const semFeriado = uteis("2025-06-02", 3);
    const comFeriado = uteis("2025-06-02", 3, {
      personalizados: [{ data: "2025-06-04", nome: "Aniversário da comarca" }],
    });
    expect(comFeriado.vencimento).not.toBe(semFeriado.vencimento);
    expect(comFeriado.trilha?.some((d) => d.feriado === "Aniversário da comarca")).toBe(true);
  });
});

describe("entradas inválidas", () => {
  it("recusa data ausente e prazo zerado", () => {
    expect(calcularPrazo({ ...base, regime: "uteis", publicacao: "", dias: 5 }).ok).toBe(false);
    expect(uteis("2025-01-10", 0).ok).toBe(false);
    expect(uteis("2025-01-10", 5000).ok).toBe(false);
  });
});
