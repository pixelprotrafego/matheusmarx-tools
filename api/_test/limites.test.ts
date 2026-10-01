// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getClientIp, isSameOrigin } from "../_lib/http.js";
import { checkIpLimit } from "../_lib/rate-limit.js";
import { MemoryStore, setStoreForTests } from "../_lib/store.js";

const req = (headers: Record<string, string>) => new Request("https://tools.exemplo.com/api/x", { headers });

describe("getClientIp", () => {
  it("prefere o x-real-ip, que a Vercel escreve e o cliente não forja", () => {
    expect(getClientIp(req({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 9.9.9.9" }))).toBe("9.9.9.9");
  });

  it("no x-forwarded-for vale o último item, não o primeiro que o cliente controla", () => {
    expect(getClientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("ignora cf-connecting-ip, que sem Cloudflare na frente é forjável", () => {
    expect(getClientIp(req({ "cf-connecting-ip": "6.6.6.6" }))).toBe("unknown");
  });
});

describe("isSameOrigin", () => {
  it("aceita o próprio site e chamadas sem Origin", () => {
    expect(isSameOrigin(req({ origin: "https://tools.exemplo.com" }))).toBe(true);
    expect(isSameOrigin(req({}))).toBe(true);
  });

  it("recusa outro site usando a função pelo navegador do visitante", () => {
    expect(isSameOrigin(req({ origin: "https://site-alheio.com" }))).toBe(false);
  });
});

describe("checkIpLimit", () => {
  // 10h30 UTC de um dia qualquer: a janela horária vence às 11h.
  const AGORA = Date.UTC(2026, 8, 30, 10, 30, 0);

  beforeEach(() => setStoreForTests(new MemoryStore(() => AGORA)));

  it("deixa passar até o limite horário e barra a próxima, dizendo quando volta", async () => {
    const r = req({ "x-real-ip": "1.1.1.1" });
    for (let i = 0; i < 10; i++) expect((await checkIpLimit(r, "t", 10, 30, AGORA)).ok).toBe(true);

    const barrada = await checkIpLimit(r, "t", 10, 30, AGORA);
    expect(barrada).toEqual({ ok: false, scope: "hourly", resetInMs: 30 * 60 * 1000 });
  });

  it("cada IP tem a própria cota", async () => {
    for (let i = 0; i < 10; i++) await checkIpLimit(req({ "x-real-ip": "1.1.1.1" }), "t", 10, 30, AGORA);
    expect((await checkIpLimit(req({ "x-real-ip": "2.2.2.2" }), "t", 10, 30, AGORA)).ok).toBe(true);
  });

  it("trocar o começo do x-forwarded-for não abre cota nova", async () => {
    for (let i = 0; i < 10; i++) {
      await checkIpLimit(req({ "x-forwarded-for": `10.0.0.${i}, 7.7.7.7` }), "t", 10, 30, AGORA);
    }
    const r = await checkIpLimit(req({ "x-forwarded-for": "10.0.0.99, 7.7.7.7" }), "t", 10, 30, AGORA);
    expect(r.ok).toBe(false);
  });

  it("o limite diário vale mesmo quando cada hora fica abaixo do horário", async () => {
    const r = req({ "x-real-ip": "3.3.3.3" });
    const HORA = 3600_000;
    let ultima;
    for (let h = 0; h < 4; h++) {
      for (let i = 0; i < 8; i++) ultima = await checkIpLimit(r, "t", 10, 30, Date.UTC(2026, 8, 30, h) + i);
    }
    expect(ultima).toMatchObject({ ok: false, scope: "daily" });
    expect(ultima?.resetInMs).toBeLessThanOrEqual(24 * HORA);
  });

  it("falha do armazenamento libera, em vez de derrubar a ferramenta", async () => {
    setStoreForTests({
      incr: async () => { throw new Error("redis fora do ar"); },
      set: async () => undefined,
      get: async () => null,
      del: async () => undefined,
      claim: async () => true,
    });
    expect((await checkIpLimit(req({ "x-real-ip": "1.1.1.1" }), "t", 10, 30)).ok).toBe(true);
  });
});
