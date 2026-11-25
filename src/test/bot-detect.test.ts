import { afterEach, describe, it, expect, vi } from "vitest";
import { isLikelyBot } from "@/lib/bot-detect";

const ANDROID_WEBVIEW =
  "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36 Instagram 355.0.0.0";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function simular(sinais: { ua: string; webdriver?: boolean; plugins?: number; languages?: string[]; chrome?: boolean }) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(sinais.ua);
  Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => sinais.webdriver ?? false });
  Object.defineProperty(navigator, "plugins", { configurable: true, get: () => ({ length: sinais.plugins ?? 3 }) });
  vi.spyOn(navigator, "languages", "get").mockReturnValue(sinais.languages ?? ["pt-BR"]);
  const w = window as Window & { chrome?: unknown };
  if (sinais.chrome) w.chrome = {};
  else delete w.chrome;
}

afterEach(() => vi.restoreAllMocks());

describe("isLikelyBot", () => {
  it("navegador embutido do Instagram no Android (sem window.chrome, sem plugins) passa", () => {
    simular({ ua: ANDROID_WEBVIEW, plugins: 0, chrome: false });
    expect(isLikelyBot()).toBe(false);
  });

  it("Chrome de computador comum passa", () => {
    simular({ ua: DESKTOP_CHROME, plugins: 5, chrome: true });
    expect(isLikelyBot()).toBe(false);
  });

  it("automação declarada e headless no user agent são bloqueados", () => {
    simular({ ua: DESKTOP_CHROME, webdriver: true, chrome: true });
    expect(isLikelyBot()).toBe(true);
    simular({ ua: DESKTOP_CHROME.replace("Chrome/", "HeadlessChrome/"), chrome: true });
    expect(isLikelyBot()).toBe(true);
  });

  it("no computador, os três sinais fracos juntos bloqueiam; dois não", () => {
    simular({ ua: DESKTOP_CHROME, plugins: 0, languages: [], chrome: false });
    expect(isLikelyBot()).toBe(true);
    simular({ ua: DESKTOP_CHROME, plugins: 0, chrome: false });
    expect(isLikelyBot()).toBe(false);
  });
});
