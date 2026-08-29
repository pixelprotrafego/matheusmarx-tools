import { describe, it, expect } from "vitest";
import {
  calcularInss,
  calcularIrrf,
  calcularRescisao,
  contarAvos,
  TABELA_INSS_PADRAO,
  type EntradaRescisao,
} from "@/lib/advocacia/rescisao";

const entrada = (over: Partial<EntradaRescisao> = {}): EntradaRescisao => ({
  salarioMensal: 3000,
  mediaVariaveis: 0,
  admissao: "2020-03-10",
  demissao: "2025-06-20",
  tipo: "sem-justa-causa",
  avisoPrevio: "indenizado",
  feriasVencidas: 0,
  saldoFgts: 0,
  dependentes: 0,
  ...over,
});

const verba = (r: ReturnType<typeof calcularRescisao>, chave: string) =>
  r.verbas?.find((v) => v.chave === chave);

describe("INSS progressivo", () => {
  it("aplica cada alíquota só sobre a parte da faixa", () => {
    // 1518,00 a 7,5% + 1275,88 a 9% + 206,12 a 12%
    expect(calcularInss(3000)).toBeCloseTo(253.41, 2);
  });

  it("cobra a alíquota menor inteira dentro da primeira faixa", () => {
    expect(calcularInss(1000)).toBeCloseTo(75, 2);
  });

  it("trava no teto", () => {
    const noTeto = calcularInss(TABELA_INSS_PADRAO.faixas[3].ate);
    expect(calcularInss(50000)).toBeCloseTo(noTeto, 2);
    expect(noTeto).toBeGreaterThan(900);
    expect(noTeto).toBeLessThan(1000);
  });

  it("não cobra nada de base zerada", () => {
    expect(calcularInss(0)).toBe(0);
  });
});

describe("IRRF", () => {
  it("isenta quem fica abaixo da primeira faixa", () => {
    expect(calcularIrrf(2000, 0, 150)).toBe(0);
  });

  it("desconta a dedução da faixa, e não a alíquota sobre o total", () => {
    // Base 5000 - INSS 500 = 4500, faixa de 22,5% com dedução de 675,49.
    expect(calcularIrrf(5000, 0, 500)).toBeCloseTo(4500 * 0.225 - 675.49, 2);
  });

  it("abate o valor por dependente", () => {
    const sem = calcularIrrf(5000, 0, 500);
    const com = calcularIrrf(5000, 2, 500);
    expect(com).toBeLessThan(sem);
  });
});

describe("avos", () => {
  it("conta doze num ano cheio", () => {
    expect(contarAvos(new Date(2024, 0, 1), new Date(2024, 11, 31))).toBe(12);
  });

  it("despreza a fração menor que quinze dias", () => {
    // 1º a 14 de janeiro: nenhum avo.
    expect(contarAvos(new Date(2024, 0, 1), new Date(2024, 0, 14))).toBe(0);
    expect(contarAvos(new Date(2024, 0, 1), new Date(2024, 0, 15))).toBe(1);
  });
});

describe("dispensa sem justa causa", () => {
  it("dá aviso de 30 dias mais 3 por ano completo", () => {
    const r = calcularRescisao(entrada());
    // Admitido em 2020, dispensado em 2025: 5 anos completos.
    expect(r.anosCompletos).toBe(5);
    expect(r.diasAviso).toBe(45);
  });

  it("limita o aviso a noventa dias", () => {
    const r = calcularRescisao(entrada({ admissao: "1990-01-10" }));
    expect(r.diasAviso).toBe(90);
  });

  it("projeta o contrato pelo aviso indenizado", () => {
    const r = calcularRescisao(entrada());
    expect(r.dataProjetada).toBe("2025-08-04");
  });

  it("aplica a multa de 40% sobre o saldo do FGTS", () => {
    const r = calcularRescisao(entrada({ saldoFgts: 10000 }));
    const multa = verba(r, "fgts-multa");
    const deposito = verba(r, "fgts-mes")!;
    expect(multa?.valor).toBeCloseTo((10000 + deposito.valor) * 0.4, 2);
  });

  it("soma proventos, descontos e líquido de forma coerente", () => {
    const r = calcularRescisao(entrada());
    const proventos = r.verbas!.filter((v) => v.grupo === "provento").reduce((s, v) => s + v.valor, 0);
    expect(r.totalProventos).toBeCloseTo(proventos, 2);
    expect(r.liquido).toBeCloseTo(r.totalProventos! - r.totalDescontos!, 2);
  });

  it("mantém o FGTS fora do líquido da rescisão", () => {
    const r = calcularRescisao(entrada({ saldoFgts: 10000 }));
    expect(r.totalFgts).toBeGreaterThan(0);
    // O líquido não pode conter nenhum centavo de FGTS.
    const somaFgts = r.verbas!.filter((v) => v.grupo === "fgts").reduce((s, v) => s + v.valor, 0);
    expect(r.liquido).toBeLessThan(somaFgts + r.totalProventos!);
  });
});

describe("justa causa", () => {
  it("não gera aviso, 13º proporcional, férias proporcionais nem multa", () => {
    const r = calcularRescisao(entrada({ tipo: "justa-causa", avisoPrevio: "dispensado" }));
    expect(r.diasAviso).toBe(0);
    expect(verba(r, "aviso")).toBeUndefined();
    expect(verba(r, "decimo")).toBeUndefined();
    expect(verba(r, "ferias-prop")).toBeUndefined();
    expect(verba(r, "fgts-multa")).toBeUndefined();
  });

  it("preserva as férias vencidas, que são direito adquirido", () => {
    const r = calcularRescisao(entrada({ tipo: "justa-causa", avisoPrevio: "dispensado", feriasVencidas: 1 }));
    expect(verba(r, "ferias-vencidas")?.valor).toBeCloseTo(3000, 2);
    expect(verba(r, "ferias-vencidas-terco")?.valor).toBeCloseTo(1000, 2);
  });
});

describe("acordo do art. 484-A", () => {
  it("paga metade do aviso e multa de 20%", () => {
    const cheio = calcularRescisao(entrada());
    const acordo = calcularRescisao(entrada({ tipo: "acordo" }));
    expect(acordo.diasAviso).toBe(Math.floor(cheio.diasAviso! / 2));
    expect(verba(acordo, "fgts-multa")?.descricao).toMatch(/20%/);
  });
});

describe("pedido de demissão", () => {
  it("não tem multa e desconta o aviso não cumprido", () => {
    const r = calcularRescisao(entrada({ tipo: "pedido-demissao" }));
    expect(verba(r, "fgts-multa")).toBeUndefined();
    expect(verba(r, "aviso-desconto")?.valor).toBeLessThan(0);
  });
});

describe("entradas inválidas", () => {
  it("recusa salário zerado e datas fora de ordem", () => {
    expect(calcularRescisao(entrada({ salarioMensal: 0 })).ok).toBe(false);
    expect(calcularRescisao(entrada({ admissao: "2025-01-01", demissao: "2024-01-01" })).ok).toBe(false);
  });
});
