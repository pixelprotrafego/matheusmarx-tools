// Detecção heurística leve de navegador headless / bot.
// Não é à prova de bala — atacante determinado contorna.
// Filtra Puppeteer/Playwright básico sem fricção pra usuário real.

/** Campos não-padrão consultados na heurística, ausentes na tipagem do DOM. */
interface BotSignals {
  webdriver?: boolean;
  userAgent?: string;
  plugins?: { length: number };
  languages?: readonly string[];
}

/**
 * Sinais fortes (automação declarada, navegador headless no user agent)
 * bastam sozinhos. Os fracos só contam juntos, os três, e nunca no celular.
 *
 * Antes, dois sinais fracos bloqueavam: "sem `window.chrome` num user agent
 * de Chrome" e "nenhum plugin". O navegador embutido dos apps no Android
 * (Instagram, Facebook) costuma ter os dois, e quem chegava por um link ou
 * anúncio nesses apps via "Acesso bloqueado" nas ferramentas pesadas.
 */
export function isLikelyBot(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const nav = navigator as Navigator & BotSignals;
  const win = window as Window & { chrome?: unknown };
  const ua = nav.userAgent ?? "";

  if (nav.webdriver) return true;
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Electron/i.test(ua)) return true;

  if (/Mobile|Android|iPhone|iPad|; wv\)/i.test(ua)) return false;
  let weak = 0;
  if (!win.chrome && /Chrome/.test(ua)) weak++;
  if (nav.plugins?.length === 0) weak++;
  if (nav.languages?.length === 0) weak++;
  return weak >= 3;
}
