import { vi } from "vitest";
import { MemoryStore, setStoreForTests } from "../_lib/store.js";

export const ORIGEM = "https://tools.exemplo.com";

/** Ambiente mínimo das funções, sem nenhuma credencial real. */
export function prepararAmbiente() {
  process.env.GROQ_API_KEY = "gsk_teste";
  process.env.TELEGRAM_BOT_TOKEN = "000000:token-de-teste";
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "42";
  setStoreForTests(new MemoryStore());
}

export interface ChamadaRegistrada {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Substitui o `fetch` global por um roteador de respostas falsas.
 *
 * Cada chamada fica registrada com URL e corpo, para o teste conferir o que o
 * servidor mandou à Groq e ao Telegram. O token do bot é tirado da URL
 * registrada, para nenhum teste depender dele.
 */
export function simularRede(rotas: Array<[RegExp, (url: string, init?: RequestInit) => Response | Promise<Response>]>) {
  const chamadas: ChamadaRegistrada[] = [];
  const fetchFalso = vi.fn(async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { /* corpo de texto, fica como veio */ }
    }
    chamadas.push({ url: url.replace(/bot[^/]+\//, "bot<token>/"), method: init?.method ?? "GET", body });
    const rota = rotas.find(([padrao]) => padrao.test(url));
    if (!rota) throw new Error(`rede simulada: nenhuma rota para ${url}`);
    return rota[1](url, init);
  });
  vi.stubGlobal("fetch", fetchFalso);
  return chamadas;
}

export const respostaJson = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

/** Respostas da Bot API que todo teste do webhook precisa. */
export const rotasTelegram = (arquivo: Uint8Array = new Uint8Array([1, 2, 3])) =>
  [
    [/api\.telegram\.org\/bot[^/]+\/getFile/, () => respostaJson({ ok: true, result: { file_path: "voice/file_1.oga" } })],
    [/api\.telegram\.org\/file\//, () => new Response(arquivo)],
    [/api\.telegram\.org\/bot[^/]+\//, () => respostaJson({ ok: true, result: {} })],
  ] as Array<[RegExp, () => Response]>;

/** Mensagens de texto que o bot mandou, na ordem. */
export const textosEnviados = (chamadas: ChamadaRegistrada[]) =>
  chamadas
    .filter((c) => c.url.endsWith("/sendMessage"))
    .map((c) => (c.body as { text: string }).text);
