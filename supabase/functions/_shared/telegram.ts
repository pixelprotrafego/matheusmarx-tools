// Helpers da Bot API do Telegram, falando direto com api.telegram.org.
// Docs: https://core.telegram.org/bots/api
//
// O token vai na própria URL, como a Bot API exige. Por isso nenhuma URL
// montada aqui pode aparecer em log ou mensagem de erro.

function botToken(): string {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? Deno.env.get("TELEGRAM_API_KEY");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente");
  return token;
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${botToken()}/${method}`;
}

function fileUrl(path: string): string {
  return `https://api.telegram.org/file/bot${botToken()}/${path}`;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function unwrap<T>(res: Response, method: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as TelegramResponse<T>;
  if (!res.ok || !data.ok) {
    const reason = data.description ?? `HTTP ${res.status}`;
    throw new Error(`tg.${method}: ${reason.slice(0, 300)}`);
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

export async function tgSendMessage(chat_id: number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

export async function tgSendPhoto(chat_id: number, photo: Blob, filename: string, caption?: string) {
  return tgMultipart("sendPhoto", chat_id, "photo", photo, filename, caption);
}

export async function tgSendDocument(chat_id: number, document: Blob, filename: string, caption?: string) {
  return tgMultipart("sendDocument", chat_id, "document", document, filename, caption);
}

async function tgMultipart(
  method: string,
  chat_id: number,
  field: string,
  blob: Blob,
  filename: string,
  caption?: string,
) {
  const fd = new FormData();
  fd.append("chat_id", String(chat_id));
  fd.append(field, blob, filename);
  if (caption) {
    fd.append("caption", caption);
    fd.append("parse_mode", "HTML");
  }
  const res = await fetch(apiUrl(method), { method: "POST", body: fd });
  return unwrap(res, method);
}

export async function tgGetFileBuffer(file_id: string): Promise<{ bytes: Uint8Array; path: string }> {
  const info = await tg<{ file_path?: string }>("getFile", { file_id });
  const path = info.file_path;
  if (!path) throw new Error("tg.getFile: resposta sem file_path");
  const res = await fetch(fileUrl(path));
  if (!res.ok) throw new Error(`download do arquivo falhou [${res.status}]`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path };
}

export async function tgAnswerCallback(callback_query_id: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id, text });
}

/**
 * Segredo do webhook derivado do próprio token, para não exigir mais um secret.
 * O mesmo valor precisa ser passado em `secret_token` ao registrar o webhook:
 *
 *   POST https://api.telegram.org/bot<TOKEN>/setWebhook
 *   { "url": "<url da function>", "secret_token": "<este valor>" }
 */
export async function deriveWebhookSecret(): Promise<string> {
  const data = new TextEncoder().encode(`telegram-webhook:${botToken()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function safeEqual(a: string | null, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
