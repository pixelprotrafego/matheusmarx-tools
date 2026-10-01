/**
 * Bot API do Telegram, falando direto com api.telegram.org.
 * Docs: https://core.telegram.org/bots/api
 *
 * O token vai na própria URL, como a Bot API exige. Por isso nenhuma URL
 * montada aqui pode aparecer em log ou em mensagem de erro.
 */

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? process.env.TELEGRAM_API_KEY;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente");
  return token;
}

const apiUrl = (method: string) => `https://api.telegram.org/bot${botToken()}/${method}`;
const fileUrl = (path: string) => `https://api.telegram.org/file/bot${botToken()}/${path}`;

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function unwrap<T>(res: Response, method: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as TelegramResponse<T>;
  if (!res.ok || !data.ok) {
    const motivo = data.description ?? `HTTP ${res.status}`;
    throw new Error(`tg.${method}: ${motivo.slice(0, 300)}`);
  }
  return data.result as T;
}

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return unwrap<T>(res, method);
}

export function tgSendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

async function tgMultipart(method: string, chatId: number, campo: string, blob: Blob, filename: string, caption?: string) {
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append(campo, blob, filename);
  if (caption) {
    fd.append("caption", caption);
    fd.append("parse_mode", "HTML");
  }
  return unwrap(await fetch(apiUrl(method), { method: "POST", body: fd }), method);
}

export const tgSendPhoto = (chatId: number, photo: Blob, filename: string, caption?: string) =>
  tgMultipart("sendPhoto", chatId, "photo", photo, filename, caption);

export const tgSendDocument = (chatId: number, doc: Blob, filename: string, caption?: string) =>
  tgMultipart("sendDocument", chatId, "document", doc, filename, caption);

export const tgAnswerCallback = (callbackQueryId: string, text?: string) =>
  tg("answerCallbackQuery", { callback_query_id: callbackQueryId, text });

/** Baixa um arquivo que alguém mandou ao bot. O Telegram serve até 20 MB por aqui. */
export async function tgGetFileBuffer(fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const info = await tg<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = info.file_path;
  if (!path) throw new Error("tg.getFile: resposta sem file_path");
  const res = await fetch(fileUrl(path));
  if (!res.ok) throw new Error(`download do arquivo falhou [${res.status}]`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path };
}

/**
 * Segredo do webhook, derivado do próprio token para não exigir mais uma
 * variável. Tem que bater com `webhookSecret()` em scripts/telegram-setup.mjs,
 * que registra o webhook passando este valor em `secret_token`; o Telegram o
 * devolve em `X-Telegram-Bot-Api-Secret-Token` a cada update.
 */
export async function deriveWebhookSecret(): Promise<string> {
  const data = new TextEncoder().encode(`telegram-webhook:${botToken()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Comparação em tempo constante, para o segredo não vazar pelo tempo de resposta. */
export function safeEqual(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Chats autorizados. Vazio significa ninguém — força quem instala a configurar. */
export function isAllowedChat(chatId: number): boolean {
  const csv = process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "";
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(chatId));
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Quebra um texto longo em pedaços abaixo do limite de ~4096 caracteres por mensagem. */
export const chunks = (texto: string, tamanho = 3800) => texto.match(new RegExp(`[\\s\\S]{1,${tamanho}}`, "g")) ?? [texto];
