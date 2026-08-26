// Detecção heurística leve de navegador headless / bot.
// Não é à prova de bala — atacante determinado contorna.
// Filtra Puppeteer/Playwright básico sem fricção pra usuário real.

export function isLikelyBot(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  let score = 0;
  const nav = navigator as any;
  const win = window as any;

  if (nav.webdriver) score += 2;
  if (!win.chrome && /Chrome/.test(nav.userAgent ?? "")) score += 1;
  if (Array.isArray(nav.plugins) ? nav.plugins.length === 0 : nav.plugins?.length === 0) score += 1;
  if (nav.languages?.length === 0) score += 1;
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Electron/i.test(nav.userAgent ?? "")) score += 3;

  return score >= 2;
}