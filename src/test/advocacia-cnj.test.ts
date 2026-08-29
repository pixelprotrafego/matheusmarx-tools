import { describe, it, expect } from "vitest";
import {
  calcularDigito,
  descreverTribunal,
  formatarCnj,
  gerarCnj,
  validarCnj,
} from "@/lib/advocacia/cnj";

describe("dígito verificador do CNJ", () => {
  it("gera um número que ele mesmo valida", () => {
    const numero = gerarCnj({ ano: 2024, segmento: "8", tribunal: "26", origem: "0100", sequencial: "1234567" });
    expect(validarCnj(numero).valido).toBe(true);
  });

  it("mantém a propriedade do módulo 97 em qualquer combinação", () => {
    // O ISO 7064 MOD 97-10 garante resto 1 no número completo. Vale para todo
    // sequencial, então uma varredura ampla vale mais que um caso isolado.
    for (let i = 0; i < 300; i++) {
      const sequencial = String(i * 7919 % 10_000_000).padStart(7, "0");
      const numero = gerarCnj({ ano: 2020 + (i % 6), segmento: "5", tribunal: "02", origem: "0001", sequencial });
      expect(validarCnj(numero).valido).toBe(true);
    }
  });

  it("recusa número com um dígito trocado e diz qual era o esperado", () => {
    const numero = gerarCnj({ ano: 2023, segmento: "8", tribunal: "19", origem: "0001", sequencial: "7654321" });
    const digitos = numero.replace(/\D/g, "");
    // Estraga o sequencial, mantendo o dígito verificador antigo.
    const trocado = (digitos[0] === "9" ? "0" : String(Number(digitos[0]) + 1)) + digitos.slice(1);

    const resultado = validarCnj(formatarCnj(trocado));
    expect(resultado.valido).toBe(false);
    expect(resultado.erro).toMatch(/[Dd]ígito verificador/);
    expect(resultado.digitoEsperado).toHaveLength(2);
    expect(resultado.digitoEsperado).not.toBe(digitos.slice(7, 9));
  });

  it("calcula o dígito com dois algarismos, inclusive quando é menor que dez", () => {
    const d = calcularDigito({ sequencial: "0000001", ano: "2024", segmento: "8", tribunal: "26", origem: "0001" });
    expect(d).toMatch(/^\d{2}$/);
  });

  it("cobra os 20 dígitos", () => {
    expect(validarCnj("123").valido).toBe(false);
    expect(validarCnj("123").erro).toMatch(/20 d[íi]gitos/);
    expect(validarCnj("").erro).toMatch(/Digite/);
  });

  it("recusa segmento inexistente", () => {
    const resultado = validarCnj("00000010420240260001");
    expect(resultado.valido).toBe(false);
    expect(resultado.erro).toMatch(/[Ss]egmento/);
  });
});

describe("identificação do tribunal", () => {
  it("reconhece tribunais estaduais pelo código da UF", () => {
    expect(descreverTribunal("8", "26")).toMatchObject({ uf: "SP" });
    expect(descreverTribunal("8", "19")).toMatchObject({ uf: "RJ" });
    expect(descreverTribunal("8", "13")).toMatchObject({ uf: "MG" });
    expect(descreverTribunal("8", "21")).toMatchObject({ uf: "RS" });
  });

  it("reconhece as regiões trabalhistas e federais", () => {
    expect(descreverTribunal("5", "02")).toMatchObject({ nome: "TRT da 2ª Região", uf: "SP" });
    expect(descreverTribunal("5", "15")).toMatchObject({ uf: "SP" });
    expect(descreverTribunal("4", "03").ufs).toEqual(expect.arrayContaining(["SP", "MS"]));
    // Minas saiu da 1ª Região quando o TRF6 foi instalado.
    expect(descreverTribunal("4", "06")).toMatchObject({ uf: "MG" });
    expect(descreverTribunal("4", "01").ufs).not.toContain("MG");
  });

  it("reconhece os tribunais superiores, que não têm subdivisão", () => {
    expect(descreverTribunal("1", "00").nome).toMatch(/Supremo/);
    expect(descreverTribunal("3", "00").nome).toMatch(/Superior Tribunal de Justiça/);
  });

  it("só admite justiça militar estadual em MG, RS e SP", () => {
    expect(descreverTribunal("9", "13").nome).toMatch(/Tribunal de Justiça Militar/);
    expect(descreverTribunal("9", "26").nome).toMatch(/Tribunal de Justiça Militar/);
    expect(descreverTribunal("9", "05").nome).toMatch(/não mantém/);
  });

  it("descreve o processo inteiro na validação", () => {
    const numero = gerarCnj({ ano: 2022, segmento: "8", tribunal: "26", origem: "0053", sequencial: "1000000" });
    const r = validarCnj(numero);
    expect(r.valido).toBe(true);
    expect(r.segmentoNome).toBe("Justiça Estadual");
    expect(r.tribunal?.uf).toBe("SP");
    expect(r.campos?.ano).toBe("2022");
    expect(r.campos?.origem).toBe("0053");
  });
});

describe("formatação", () => {
  it("aceita entrada com e sem máscara", () => {
    const numero = gerarCnj({ ano: 2024, segmento: "8", tribunal: "26", origem: "0001", sequencial: "0000001" });
    const cru = numero.replace(/\D/g, "");
    expect(validarCnj(cru).valido).toBe(true);
    expect(validarCnj(numero).formatado).toBe(numero);
  });

  it("monta a máscara no padrão da Resolução", () => {
    expect(formatarCnj("12345678920248260001")).toBe("1234567-89.2024.8.26.0001");
  });
});
