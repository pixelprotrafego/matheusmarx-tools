import { describe, it, expect } from "vitest";
import { evaluate, formatNumber } from "@/lib/calc-engine";

describe("evaluate — aritmética", () => {
  it("respeita a precedência dos operadores", () => {
    expect(evaluate("2+2*5")).toBe(12);
    expect(evaluate("(2+2)*5")).toBe(20);
  });

  it("trata o menos unário", () => {
    expect(evaluate("-3+5")).toBe(2);
    expect(evaluate("-(2+3)")).toBe(-5);
    expect(evaluate("2*-3")).toBe(-6);
  });

  it("aplica potência da direita para a esquerda", () => {
    // 2^(3^2) = 2^9, e não (2^3)^2 = 64
    expect(evaluate("2^3^2")).toBe(512);
  });

  it("calcula módulo", () => {
    expect(evaluate("10 mod 3")).toBe(1);
  });

  it("lê porcentagem como divisão por cem", () => {
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("200*10%")).toBeCloseTo(20, 10);
  });

  it("calcula fatorial como sufixo", () => {
    expect(evaluate("5!")).toBe(120);
    expect(evaluate("0!")).toBe(1);
    expect(evaluate("2*3!")).toBe(12);
  });

  it("aceita os símbolos de teclado numérico", () => {
    expect(evaluate("6×7")).toBe(42);
    expect(evaluate("84÷2")).toBe(42);
    expect(evaluate("−5+7")).toBe(2);
  });
});

describe("evaluate — funções e constantes", () => {
  it("usa graus por padrão", () => {
    expect(evaluate("sin(90)")).toBeCloseTo(1, 10);
    expect(evaluate("cos(0)")).toBe(1);
  });

  it("aceita radianos quando pedido", () => {
    expect(evaluate("sin(pi/2)", "rad")).toBeCloseTo(1, 10);
  });

  it("inverte funções trigonométricas no mesmo modo", () => {
    expect(evaluate("asin(1)")).toBeCloseTo(90, 10);
    expect(evaluate("asin(1)", "rad")).toBeCloseTo(Math.PI / 2, 10);
  });

  it("resolve logaritmos e raiz", () => {
    expect(evaluate("log(1000)")).toBeCloseTo(3, 10);
    expect(evaluate("ln(e)")).toBeCloseTo(1, 10);
    expect(evaluate("sqrt(144)")).toBe(12);
  });

  it("conhece pi e e", () => {
    expect(evaluate("pi")).toBeCloseTo(Math.PI, 10);
    expect(evaluate("π")).toBeCloseTo(Math.PI, 10);
    expect(evaluate("e")).toBeCloseTo(Math.E, 10);
  });
});

describe("evaluate — erros", () => {
  it("recusa expressão incompleta", () => {
    expect(() => evaluate("2+")).toThrow();
  });

  it("recusa parênteses desbalanceados", () => {
    expect(() => evaluate("(1+2")).toThrow(/Parêntese/);
    expect(() => evaluate("1+2)")).toThrow(/Parêntese/);
  });

  it("recusa identificador desconhecido", () => {
    expect(() => evaluate("foo(2)")).toThrow(/Identificador desconhecido/);
  });

  it("recusa caractere inválido", () => {
    expect(() => evaluate("2 $ 3")).toThrow(/Caractere inválido/);
  });

  it("recusa divisão por zero em vez de devolver Infinity", () => {
    expect(() => evaluate("1/0")).toThrow(/Resultado inválido/);
  });

  it("recusa fatorial de fracionário e de negativo", () => {
    expect(() => evaluate("2.5!")).toThrow(/fatorial inválido/);
    expect(() => evaluate("(-3)!")).toThrow(/fatorial inválido/);
  });
});

describe("formatNumber", () => {
  it("absorve o ruído do ponto flutuante", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
  });

  it("mantém inteiros sem casas decimais", () => {
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(-7)).toBe("-7");
  });

  it("usa notação científica nos extremos", () => {
    expect(formatNumber(1e20)).toContain("e+");
    expect(formatNumber(1e-12)).toContain("e-");
  });

  it("devolve Erro para valores não finitos", () => {
    expect(formatNumber(Infinity)).toBe("Erro");
    expect(formatNumber(NaN)).toBe("Erro");
  });
});

describe("evaluate — correções", () => {
  it("menos unário abaixo da potência, como na matemática", () => {
    expect(evaluate("-2^2")).toBe(-4);
    expect(evaluate("(-2)^2")).toBe(4);
    expect(evaluate("2^-2")).toBe(0.25);
    expect(evaluate("2*-3^2")).toBe(-18);
    expect(evaluate("-3!")).toBe(-6);
  });

  it("multiplicação implícita: 2π, 3(1+1), (2)(3)", () => {
    expect(evaluate("2π")).toBeCloseTo(2 * Math.PI, 12);
    expect(evaluate("3(1+1)")).toBe(6);
    expect(evaluate("(2)(3)")).toBe(6);
    expect(evaluate("2sqrt(9)")).toBe(6);
  });

  it("porcentagem pega só o número à esquerda", () => {
    expect(evaluate("2^50%")).toBeCloseTo(Math.SQRT2, 12);
  });

  it("lê o próprio resultado em notação científica e a vírgula decimal", () => {
    expect(evaluate("1.5e-7*2")).toBeCloseTo(3e-7, 20);
    expect(evaluate(formatNumber(1e20) + "/1e20")).toBe(1);
    expect(evaluate("2,5*2")).toBe(5);
  });

  it("recusa número com dois pontos em vez de ler só o começo", () => {
    expect(() => evaluate("1.2.3")).toThrow(/Número inválido/);
  });

  it("ângulos notáveis dão o valor exato", () => {
    expect(evaluate("sin(180)")).toBe(0);
    expect(evaluate("cos(90)")).toBe(0);
    expect(evaluate("sin(pi)", "rad")).toBe(0);
    expect(() => evaluate("tan(90)")).toThrow(/Resultado inválido/);
  });

  it("resto com o sinal do divisor", () => {
    expect(evaluate("-7 mod 3")).toBe(2);
    expect(evaluate("7 mod 3")).toBe(1);
  });
});

describe("formatNumber — correções", () => {
  it("inteiro grande sai com todos os algarismos", () => {
    expect(formatNumber(123456789012345)).toBe("123456789012345");
  });

  it("notação científica sem zeros sobrando", () => {
    expect(formatNumber(1e20)).toBe("1e+20");
    expect(formatNumber(2.5e-12)).toBe("2.5e-12");
  });
});
