#!/usr/bin/env node
/**
 * Configura o webhook do bot do Telegram.
 *
 * Antes isso era feito pelo painel da Lovable. Agora que o bot fala direto com
 * api.telegram.org, o registro do webhook é nosso — este script faz isso.
 *
 * Uso:
 *   node scripts/telegram-setup.mjs status
 *   node scripts/telegram-setup.mjs set https://<projeto>.supabase.co/functions/v1/telegram-webhook
 *   node scripts/telegram-setup.mjs chat-id
 *   node scripts/telegram-setup.mjs delete
 *
 * O token vem da variável de ambiente TELEGRAM_BOT_TOKEN (ou TELEGRAM_API_KEY).
 * No PowerShell:  $env:TELEGRAM_BOT_TOKEN = "123456:ABC..."
 */

import { createHash } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_API_KEY;

if (!token) {
  console.error("Erro: defina TELEGRAM_BOT_TOKEN no ambiente antes de rodar.");
  console.error('PowerShell:  $env:TELEGRAM_BOT_TOKEN = "123456:ABC..."');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

/**
 * Precisa bater exatamente com deriveWebhookSecret() em
 * supabase/functions/_shared/telegram.ts — é o valor que o Telegram devolve
 * no cabeçalho X-Telegram-Bot-Api-Secret-Token a cada update.
 */
function webhookSecret() {
  return createHash("sha256")
    .update(`telegram-webhook:${token}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function call(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${data.description ?? `HTTP ${res.status}`}`);
  return data.result;
}

async function status() {
  const me = await call("getMe");
  console.log(`Bot:      @${me.username} (${me.first_name}), id ${me.id}`);

  const info = await call("getWebhookInfo");
  console.log(`Webhook:  ${info.url || "(nenhum registrado)"}`);
  console.log(`Pendentes: ${info.pending_update_count ?? 0}`);
  if (info.last_error_message) {
    console.log(`Último erro: ${info.last_error_message} (em ${new Date((info.last_error_date ?? 0) * 1000).toISOString()})`);
  }
  const armed = Boolean(info.has_custom_certificate) || info.url;
  if (armed && !info.url.includes("/functions/v1/telegram-webhook")) {
    console.log("Aviso: a URL registrada não parece ser a edge function deste projeto.");
  }
}

async function set(url) {
  if (!url) {
    console.error("Informe a URL da function. Ex.:");
    console.error("  node scripts/telegram-setup.mjs set https://SEU-PROJETO.supabase.co/functions/v1/telegram-webhook");
    process.exit(1);
  }
  const secret = webhookSecret();
  await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "edited_message", "callback_query"],
    drop_pending_updates: true,
  });
  console.log("Webhook registrado.");
  console.log(`URL:    ${url}`);
  console.log(`Secret: ${secret}`);
  console.log();
  console.log("O secret é derivado do próprio token, então a edge function o recalcula");
  console.log("sozinha — não precisa guardá-lo em lugar nenhum.");
  console.log();
  console.log("Confirme que estes secrets existem no Supabase:");
  console.log("  supabase secrets set TELEGRAM_BOT_TOKEN=<o mesmo token>");
  console.log("  supabase secrets set GROQ_API_KEY=<sua chave da Groq>");
  console.log("  supabase secrets set TELEGRAM_ALLOWED_CHAT_IDS=<seu chat id>");
}

async function chatId() {
  const info = await call("getWebhookInfo");
  if (info.url) {
    console.log("Há um webhook registrado, então getUpdates fica indisponível.");
    console.log("Remova o webhook, mande uma mensagem ao bot e rode de novo:");
    console.log("  node scripts/telegram-setup.mjs delete");
    console.log("  node scripts/telegram-setup.mjs chat-id");
    console.log("  node scripts/telegram-setup.mjs set <url>");
    return;
  }
  const updates = await call("getUpdates", { limit: 20 });
  if (!updates.length) {
    console.log("Nenhuma mensagem recente. Mande qualquer mensagem ao bot e rode de novo.");
    return;
  }
  const seen = new Map();
  for (const u of updates) {
    const msg = u.message ?? u.edited_message ?? u.callback_query?.message;
    const chat = msg?.chat;
    if (chat) seen.set(chat.id, chat.username ?? chat.title ?? chat.first_name ?? "");
  }
  console.log("Chat ids encontrados:");
  for (const [id, name] of seen) console.log(`  ${id}  ${name}`);
  console.log();
  console.log("Use em TELEGRAM_ALLOWED_CHAT_IDS (separe por vírgula se for mais de um).");
}

async function remove() {
  await call("deleteWebhook", { drop_pending_updates: false });
  console.log("Webhook removido.");
}

const [cmd, arg] = process.argv.slice(2);

try {
  if (cmd === "status") await status();
  else if (cmd === "set") await set(arg);
  else if (cmd === "chat-id") await chatId();
  else if (cmd === "delete") await remove();
  else {
    console.log("Comandos: status | set <url> | chat-id | delete");
    process.exit(1);
  }
} catch (err) {
  console.error(`Falhou: ${err.message}`);
  process.exit(1);
}
