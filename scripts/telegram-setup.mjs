#!/usr/bin/env node
/**
 * Configura o webhook do bot do Telegram.
 *
 * O bot roda na função api/telegram.ts, na Vercel. Este script diz ao Telegram
 * para onde mandar as mensagens e com qual segredo.
 *
 * Uso:
 *   node scripts/telegram-setup.mjs status
 *   node scripts/telegram-setup.mjs set https://<seu-dominio>/api/telegram
 *   node scripts/telegram-setup.mjs chat-id
 *   node scripts/telegram-setup.mjs delete
 *
 * O token vem da variável de ambiente TELEGRAM_BOT_TOKEN (ou TELEGRAM_API_KEY).
 * No PowerShell:  $env:TELEGRAM_BOT_TOKEN = "<cole-o-token-aqui>"
 *
 * Os exemplos aqui e na mensagem de erro abaixo são propositalmente marcadores
 * entre <>, e não um token de mentira com a cara de um de verdade. Um token
 * falso mas com o formato correto dispara o secret scanning do GitHub em quem
 * clonar o repositório, e o alerta é indistinguível de um vazamento real até
 * alguém ir conferir à mão.
 */

import { createHash } from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_API_KEY;

if (!token) {
  console.error("Erro: defina TELEGRAM_BOT_TOKEN no ambiente antes de rodar.");
  console.error();
  console.error("É o token do BOT, que o @BotFather entrega quando você cria o bot.");
  console.error("Não é o seu id de usuário do Telegram, nem o nome do bot.");
  console.error();
  console.error("Formato: o id numérico do bot, dois-pontos, e cerca de 35");
  console.error("caracteres entre letras, números, hífen e sublinhado:");
  console.error("  <id-numérico-do-bot>:<sequência-de-~35-caracteres>");
  console.error();
  console.error("Onde achar: no Telegram, fale com @BotFather, mande /mybots,");
  console.error("escolha o seu bot e toque em 'API Token'.");
  console.error();
  console.error('PowerShell:  $env:TELEGRAM_BOT_TOKEN = "<cole-o-token-aqui>"');
  console.error('bash:        export TELEGRAM_BOT_TOKEN="<cole-o-token-aqui>"');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

/**
 * Precisa bater exatamente com deriveWebhookSecret() em api/_lib/telegram.ts —
 * há um teste conferindo isso. É o valor que o Telegram devolve
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
  if (armed && !info.url.endsWith("/api/telegram")) {
    console.log("Aviso: a URL registrada não termina em /api/telegram, que é a função deste projeto.");
  }
}

async function set(url) {
  if (!url) {
    console.error("Informe a URL da função do bot: o endereço do site + /api/telegram. Ex.:");
    console.error("  node scripts/telegram-setup.mjs set https://tools.matheusmarx.com.br/api/telegram");
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
  console.log("O secret é derivado do próprio token, então a função o recalcula");
  console.log("sozinha — não precisa guardá-lo em lugar nenhum.");
  console.log();
  console.log("Confirme que estas variáveis existem na Vercel (Settings → Environment");
  console.log("Variables), e que houve um deploy depois de cadastrá-las:");
  console.log("  TELEGRAM_BOT_TOKEN         o mesmo token usado aqui");
  console.log("  TELEGRAM_ALLOWED_CHAT_IDS  o id da sua conta (npm run telegram chat-id)");
  console.log("  GROQ_API_KEY               sua chave da Groq, para transcrever áudio");
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
    const me = await call("getMe");
    console.log("Nenhuma mensagem recente.");
    console.log();
    console.log(`Abra o Telegram, procure por @${me.username} e mande qualquer`);
    console.log('mensagem para o bot (um "oi" basta). Depois rode este comando de novo.');
    return;
  }
  const seen = new Map();
  for (const u of updates) {
    const msg = u.message ?? u.edited_message ?? u.callback_query?.message;
    const chat = msg?.chat;
    if (chat) seen.set(chat.id, chat.username ?? chat.title ?? chat.first_name ?? "");
  }
  console.log("Chat ids que falaram com o bot:");
  for (const [id, name] of seen) console.log(`  ${id}  ${name}`);
  console.log();
  console.log("Este número identifica a SUA conta do Telegram, não o bot — é ele");
  console.log("que autoriza você a usar o bot. Cadastre na Vercel, em Settings →");
  console.log("Environment Variables, e faça um novo deploy:");
  const first = [...seen.keys()][0];
  console.log(`  TELEGRAM_ALLOWED_CHAT_IDS = ${first}`);
  console.log();
  console.log("Para liberar mais de uma pessoa, separe os ids por vírgula.");
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
