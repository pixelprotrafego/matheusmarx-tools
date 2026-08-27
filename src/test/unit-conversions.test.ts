import { describe, it, expect } from "vitest";
import { CATEGORIES, convert, formatConverted, type CategoryKey } from "@/lib/unit-conversions";

const cat = (key: CategoryKey) => {
  const found = CATEGORIES.find((c) => c.key === key);
  if (!found) throw new Error(`categoria ausente: ${key}`);
  return found;
};

describe("convert — distância", () => {
  const distance = cat("distance");

  it("converte entre unidades métricas", () => {
    expect(convert(1, distance, "km", "m")).toBeCloseTo(1000, 10);
    expect(convert(2500, distance, "mm", "m")).toBeCloseTo(2.5, 10);
  });

  it("converte entre métrico e imperial", () => {
    expect(convert(1, distance, "in", "cm")).toBeCloseTo(2.54, 10);
    expect(convert(1, distance, "mi", "km")).toBeCloseTo(1.609344, 10);
    expect(convert(1, distance, "nmi", "m")).toBeCloseTo(1852, 10);
  });

  it("é reversível", () => {
    const ida = convert(42, distance, "ft", "m");
    expect(convert(ida, distance, "m", "ft")).toBeCloseTo(42, 10);
  });
});

describe("convert — massa", () => {
  const mass = cat("mass");

  it("converte quilos e libras", () => {
    expect(convert(1, mass, "lb", "kg")).toBeCloseTo(0.45359237, 10);
    expect(convert(1000, mass, "g", "kg")).toBeCloseTo(1, 10);
    expect(convert(1, mass, "t", "kg")).toBeCloseTo(1000, 10);
  });
});

describe("convert — temperatura (afim, não proporcional)", () => {
  const temp = cat("temperature");

  it("converte Celsius para Fahrenheit", () => {
    expect(convert(0, temp, "C", "F")).toBeCloseTo(32, 10);
    expect(convert(100, temp, "C", "F")).toBeCloseTo(212, 10);
    expect(convert(-40, temp, "C", "F")).toBeCloseTo(-40, 10);
  });

  it("converte Celsius para Kelvin", () => {
    expect(convert(0, temp, "C", "K")).toBeCloseTo(273.15, 10);
    expect(convert(-273.15, temp, "C", "K")).toBeCloseTo(0, 10);
  });

  it("converte Fahrenheit para Kelvin", () => {
    expect(convert(32, temp, "F", "K")).toBeCloseTo(273.15, 10);
  });

  it("mantém o valor ao converter para a mesma unidade", () => {
    expect(convert(37, temp, "C", "C")).toBeCloseTo(37, 10);
  });
});

describe("convert — velocidade", () => {
  const speed = cat("speed");

  it("converte km/h e m/s", () => {
    expect(convert(3.6, speed, "kmh", "mps")).toBeCloseTo(1, 10);
    expect(convert(1, speed, "mps", "kmh")).toBeCloseTo(3.6, 10);
  });
});

describe("convert — entradas inválidas", () => {
  it("devolve NaN para unidade inexistente", () => {
    expect(convert(1, cat("distance"), "parsec", "m")).toBeNaN();
    expect(convert(1, cat("distance"), "m", "parsec")).toBeNaN();
  });
});

describe("catálogo de unidades", () => {
  it("não tem id repetido dentro de uma categoria", () => {
    for (const c of CATEGORIES) {
      const ids = c.units.map((u) => u.id);
      expect(new Set(ids).size, `ids repetidos em ${c.key}`).toBe(ids.length);
    }
  });

  it("declara a unidade base em toda categoria", () => {
    for (const c of CATEGORIES) {
      expect(c.units.some((u) => u.id === c.base), `base ausente em ${c.key}`).toBe(true);
    }
  });

  it("usa fatores positivos e finitos", () => {
    for (const c of CATEGORIES) {
      for (const u of c.units) {
        expect(Number.isFinite(u.factor), `${c.key}.${u.id}`).toBe(true);
        expect(u.factor).toBeGreaterThan(0);
      }
    }
  });
});

describe("formatConverted", () => {
  it("mostra zero como zero", () => {
    expect(formatConverted(0)).toBe("0");
  });

  it("absorve o ruído do ponto flutuante", () => {
    expect(formatConverted(0.1 + 0.2)).toBe("0.3");
  });

  it("usa notação científica nos extremos", () => {
    expect(formatConverted(1e15)).toContain("e+");
    expect(formatConverted(1e-9)).toContain("e-");
  });

  it("devolve travessão para valores não finitos", () => {
    expect(formatConverted(NaN)).toBe("—");
    expect(formatConverted(Infinity)).toBe("—");
  });
});
