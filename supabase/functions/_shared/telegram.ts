// Telegram Bot API helpers via Lovable connector gateway.
const GATEWAY = "https://connector-gateway.lovable.dev/telegram";

function authHeaders() {
  const lk = Deno.env.get("LOVABLE_API_KEY");
  const tk = Deno.env.get("TELEGRAM_API_KEY");
  if (!lk) throw new Error("LOVABLE_API_KEY ausente");
  if (!tk) throw new Error("TELEGRAM_API_KEY ausente");
  return {
    Authorization: `Bearer ${lk}`,
    "X-Connection-Api-Key": tk,
  };
}

export async function tg(method: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${GATEWAY}/${method}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`tg.${method} [${res.status}]: ${JSON.stringify(data).slice(0, 300)}`);
  return data.result;
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

async function tgMultipart(method: string, chat_id: number, field: string, blob: Blob, filename: string, caption?: string) {
  const fd = new FormData();
  fd.append("chat_id", String(chat_id));
  fd.append(field, blob, filename);
  if (caption) fd.append("caption", caption);
  const res = await fetch(`${GATEWAY}/${method}`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`tg.${method} [${res.status}]: ${JSON.stringify(data).slice(0, 300)}`);
  return data.result;
}

export async function tgGetFileBuffer(file_id: string): Promise<{ bytes: Uint8Array; path: string }> {
  const info = await tg("getFile", { file_id });
  const path = info.file_path as string;
  const res = await fetch(`${GATEWAY}/file/${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`download falhou [${res.status}]`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path };
}

export async function tgAnswerCallback(callback_query_id: string, text?: string) {
  return tg("answerCallbackQuery", { callback_query_id, text });
}

export async function deriveWebhookSecret(): Promise<string> {
  const tk = Deno.env.get("TELEGRAM_API_KEY") ?? "";
  const data = new TextEncoder().encode(`telegram-webhook:${tk}`);
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