/**
 * Carregamento opcional do Meta Pixel.
 *
 * O pixel ficava cravado no `index.html`, o que criava dois problemas assim que
 * o código passou a ser público: qualquer pessoa que clonasse o projeto e o
 * hospedasse passaria a mandar rastreamento para o pixel de outra pessoa, sem
 * saber; e um aplicativo que promete não enviar nada para lugar nenhum abria
 * conexão com um rastreador em toda visita, o que contradiz a própria proposta.
 *
 * Agora ele só existe quando `VITE_META_PIXEL_ID` é definida no ambiente de
 * build. Sem a variável — que é o caso de quem clona o repositório, roda em
 * Docker ou usa em `localhost` — nenhum byte sai da máquina.
 *
 * Quem hospeda com rastreamento ligado precisa também liberar os domínios do
 * Meta na CSP; veja `vercel.json` e `docker/nginx.conf`.
 */

const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID?.trim();

/** Só dígitos: o id do pixel é numérico e isso barra injeção via ambiente. */
const VALID_ID = /^\d{6,20}$/;

interface FacebookQueue {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: FacebookQueue;
  loaded: boolean;
  version: string;
}

declare global {
  interface Window {
    fbq?: FacebookQueue;
    _fbq?: FacebookQueue;
  }
}

/**
 * Liga o Meta Pixel, se houver id configurado. Chamar mais de uma vez não
 * duplica o carregamento.
 */
export function initAnalytics(): void {
  if (!PIXEL_ID || !VALID_ID.test(PIXEL_ID)) return;
  if (typeof window === "undefined" || window.fbq) return;

  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue.push(args);
  } as FacebookQueue;

  fbq.queue = [];
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = "2.0";

  window.fbq = fbq;
  if (!window._fbq) window._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);

  fbq("init", PIXEL_ID);
  fbq("track", "PageView");
}
