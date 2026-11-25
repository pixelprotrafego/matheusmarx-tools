// @vitest-environment node
import { describe, it, expect } from "vitest";
import { generatePassword } from "../_lib/password.js";

describe("generatePassword", () => {
  it("toda senha tem ao menos um caractere de cada tipo pedido", () => {
    for (let i = 0; i < 2000; i++) {
      const s = generatePassword({ length: 8, upper: true, digits: true, symbols: true });
      expect(s).toHaveLength(8);
      expect(s).toMatch(/[a-z]/);
      expect(s).toMatch(/[A-Z]/);
      expect(s).toMatch(/[2-9]/);
      expect(s).toMatch(/[!@#$%&*?+\-_=]/);
    }
  });

  it("respeita o tamanho mínimo e máximo", () => {
    expect(generatePassword({ length: 2, upper: false, digits: false, symbols: false })).toHaveLength(6);
    expect(generatePassword({ length: 999, upper: true, digits: true, symbols: false })).toHaveLength(128);
  });
});
