import { corsHeaders } from "../_shared/cors.ts";
import {
  tgSendMessage, tgSendPhoto, tgSendDocument, tgGetFileBuffer,
  tgAnswerCallback, deriveWebhookSecret, safeEqual,
} from "../_shared/telegram.ts";
import { runCommand } from "../_shared/router.ts";
import { groqTranscribe } from "../_shared/groq.ts";
import { splitPdf, rotatePdf, pdfInfo, pdfToDocx } from "../_shared/pdf-ops.ts";
import { convertImage, resizeImage, imageToPdf } from "../_shared/image-ops.ts";
import { docxToText, xlsxToText } from "../_shared/doc-ops.ts";
import { setPending, takePending, hasPending } from "../_shared/pending.ts";
import { putFile, getFile } from "../_shared/file-store.ts";

/** Botão do teclado inline do Telegram. */
interface InlineButton {
  text: string;
  callback_data: string;
}

/** Recorte do objeto Update que este webhook consome. */
interface TelegramFile {
  file_id: string;
  mime_type?: string;
  file_name?: string;
  file_unique_id?: string;
}

interface TelegramMessage {
  chat?: { id: number };
  from?: { id?: number; username?: string };
  text?: string;
  voice?: TelegramFile;
  audio?: TelegramFile;
  document?: TelegramFile;
  photo?: TelegramFile[];
}

interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat?: { id: number } };
  };
}

// Dedupe simples em memória (boot único da instância)
const seen = new Set<number>();
function dedupe(id: number): boolean {
  if (seen.has(id)) return true;
  seen.add(id);
  if (seen.size > 500) { const it = seen.values().next().value; if (it !== undefined) seen.delete(it); }
  return false;
}

function isAllowed(chatId: number): boolean {
  const csv = Deno.env.get("TELEGRAM_ALLOWED_CHAT_IDS") ?? "";
  if (!csv.trim()) return false; // por padrão, ninguém — força configurar
  return csv.split(",").map((s) => s.trim()).filter(Boolean).includes(String(chatId));
}

async function handleCommand(chatId: number, text: string) {
  const trimmed = text.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).split("@")[0].toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  const result = await runCommand(cmd, args);
  if (result.blob && result.filename) {
    if (result.asPhoto) {
      await tgSendPhoto(chatId, result.blob, result.filename, result.text ?? undefined);
    } else {
      await tgSendDocument(chatId, result.blob, result.filename, result.text ?? undefined);
    }
  } else if (result.text) {
    await tgSendMessage(chatId, result.text);
  }
}

async function handleAudio(chatId: number, fileId: string, mime?: string) {
  await tgSendMessage(chatId, "🎙️ Baixando e transcrevendo...");
  try {
    const { bytes, path } = await tgGetFileBuffer(fileId);
    const filename = normalizeAudioFilename(path, mime);
    const blob = new Blob([bytes], { type: mime || "audio/ogg" });
    const r = await groqTranscribe({
      file: blob, filename, responseFormat: "json", temperature: 0,
    });
    const text = (r.text || "").trim() || "(sem fala detectada)";
    // Telegram limit ~4096 chars
    const chunks = text.match(/[\s\S]{1,3800}/g) ?? [text];
    for (const c of chunks) await tgSendMessage(chatId, `📝 <i>Transcrição:</i>\n\n${escapeHtml(c)}`);
  } catch (e) {
    await tgSendMessage(chatId, `❌ Falha ao transcrever: ${e instanceof Error ? e.message : "erro"}`);
  }
}

// Groq aceita: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm.
// Telegram entrega voice como .oga (ogg/opus) — não aceito pelo Groq, precisa virar .ogg.
function normalizeAudioFilename(originalPath: string, mime?: string): string {
  const last = originalPath.split("/").pop() || "audio";
  const base = last.replace(/\.[^.]+$/, "") || "audio";
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus") || /\.oga$/i.test(originalPath)) return `${base}.ogg`;
  if (m.includes("mpeg") || m.includes("mp3")) return `${base}.mp3`;
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return `${base}.m4a`;
  if (m.includes("wav")) return `${base}.wav`;
  if (m.includes("webm")) return `${base}.webm`;
  if (m.includes("flac")) return `${base}.flac`;
  // fallback: voice do Telegram é sempre OGG/Opus
  return `${base}.ogg`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function fileTypeMenu(chatId: number, fileId: string, mime: string, filename: string) {
  const key = await putFile(chatId, fileId, mime, filename);

  const isPdf = mime === "application/pdf" || /\.pdf$/i.test(filename);
  const isImg = mime.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(filename);
  const isAudio = mime.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|opus|flac|oga)$/i.test(filename);
  const isDocx = /officedocument\.wordprocessingml/.test(mime) || /\.docx$/i.test(filename);
  const isXlsx = /spreadsheetml/.test(mime) || /\.xlsx$/i.test(filename);

  const rows: { text: string; cb: string }[][] = [];

  if (isPdf) {
    rows.push([
      { text: "📝 Extrair texto", cb: `p:${key}` },
      { text: "📄 → Word (.docx)", cb: `pd:${key}` },
    ]);
    rows.push([
      { text: "✂️ Separar páginas", cb: `ps:${key}` },
      { text: "🔄 Rotacionar 90°", cb: `pr:${key}` },
    ]);
    rows.push([{ text: "📊 Info do PDF", cb: `pi:${key}` }]);
  } else if (isImg) {
    rows.push([
      { text: "🖼️ → PNG", cb: `ic:${key}:png` },
      { text: "🖼️ → JPG", cb: `ic:${key}:jpeg` },
      { text: "🖼️ → WebP", cb: `ic:${key}:webp` },
    ]);
    rows.push([
      { text: "📏 Redimensionar", cb: `iz:${key}` },
      { text: "📄 → PDF", cb: `ip:${key}` },
    ]);
  } else if (isAudio) {
    rows.push([{ text: "🎙️ Transcrever", cb: `t:${key}` }]);
  } else if (isDocx) {
    rows.push([{ text: "📝 Extrair texto", cb: `dx:${key}` }]);
  } else if (isXlsx) {
    rows.push([{ text: "📝 Extrair texto (CSV)", cb: `xl:${key}` }]);
  } else {
    return {
      text: `Recebi <b>${escapeHtml(filename)}</b> (${mime || "tipo desconhecido"}).\nFormato ainda não suportado pelo bot.`,
      keyboard: { inline_keyboard: [] as InlineButton[][] },
    };
  }

  return {
    text: `Recebi <b>${escapeHtml(filename)}</b> (${mime || "tipo desconhecido"}).\nO que deseja fazer?`,
    keyboard: { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.cb }))) },
  };
}

async function handleCallback(chatId: number, data: string) {
  const parts = data.split(":");
  const op = parts[0];
  const key = parts[1];
  const arg = parts[2];
  const item = await getFile(key);
  if (!item) { await tgSendMessage(chatId, "⏱️ Ação expirou. Reenvie o arquivo."); return; }

  try {
    if (op === "t") { await handleAudio(chatId, item.fileId, item.mime); return; }

    if (op === "p") {
      await tgSendMessage(chatId, "📝 Extraindo texto do PDF...");
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const { extractText, getDocumentProxy } = await import("npm:unpdf@0.12.1");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: true });
      const out = (text || "").trim() || "(PDF sem texto extraível — pode ser imagem escaneada)";
      for (const c of (out.match(/[\s\S]{1,3800}/g) ?? [out])) await tgSendMessage(chatId, `📄 ${escapeHtml(c)}`);
      return;
    }
    if (op === "pd") {
      await tgSendMessage(chatId, "📄 Convertendo PDF para Word...");
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const out = await pdfToDocx(bytes);
      const base = item.filename.replace(/\.[^.]+$/, "") || "documento";
      await tgSendDocument(chatId, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${base}.docx`);
      return;
    }
    if (op === "ps") {
      await setPending(chatId, { op: "split", fileId: item.fileId, mime: item.mime, filename: item.filename });
      await tgSendMessage(chatId, "✂️ Envie o range das páginas. Ex.: <code>1-3,5,8-10</code>");
      return;
    }
    if (op === "pr") {
      await tgSendMessage(chatId, "🔄 Rotacionando...");
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const out = await rotatePdf(bytes, 90);
      const base = item.filename.replace(/\.[^.]+$/, "") || "documento";
      await tgSendDocument(chatId, new Blob([out], { type: "application/pdf" }), `${base}-rotacionado.pdf`);
      return;
    }
    if (op === "pi") {
      const { bytes } = await tgGetFileBuffer(item.fileId);
      await tgSendMessage(chatId, await pdfInfo(bytes));
      return;
    }

    if (op === "ic") {
      const target = (arg as "png" | "jpeg" | "webp");
      await tgSendMessage(chatId, `🖼️ Convertendo para ${target.toUpperCase()}...`);
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const r = await convertImage(bytes, target);
      const base = item.filename.replace(/\.[^.]+$/, "") || "imagem";
      let caption: string | undefined;
      if (target === "webp" && r.mime !== "image/webp") caption = "(WebP indisponível no runtime — enviado como PNG)";
      await tgSendDocument(chatId, new Blob([r.bytes], { type: r.mime }), `${base}.${r.ext}`, caption);
      return;
    }
    if (op === "iz") {
      await setPending(chatId, { op: "resize", fileId: item.fileId, mime: item.mime, filename: item.filename });
      await tgSendMessage(chatId, "📏 Envie a largura em pixels. Ex.: <code>800</code>");
      return;
    }
    if (op === "ip") {
      await tgSendMessage(chatId, "📄 Gerando PDF...");
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const out = await imageToPdf(bytes, item.mime);
      const base = item.filename.replace(/\.[^.]+$/, "") || "imagem";
      await tgSendDocument(chatId, new Blob([out], { type: "application/pdf" }), `${base}.pdf`);
      return;
    }

    if (op === "dx") {
      await tgSendMessage(chatId, "📝 Extraindo texto do Word...");
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const out = (await docxToText(bytes)) || "(sem texto)";
      for (const c of (out.match(/[\s\S]{1,3800}/g) ?? [out])) await tgSendMessage(chatId, `📄 ${escapeHtml(c)}`);
      return;
    }
    if (op === "xl") {
      await tgSendMessage(chatId, "📝 Extraindo planilha...");
      const { bytes } = await tgGetFileBuffer(item.fileId);
      const out = (await xlsxToText(bytes)) || "(planilha vazia)";
      for (const c of (out.match(/[\s\S]{1,3800}/g) ?? [out])) await tgSendMessage(chatId, `📊 <pre>${escapeHtml(c)}</pre>`);
      return;
    }
  } catch (e) {
    await tgSendMessage(chatId, `❌ ${e instanceof Error ? e.message : "erro"}`);
  }
}

async function handlePendingText(chatId: number, text: string): Promise<boolean> {
  if (!(await hasPending(chatId))) return false;
  const p = await takePending(chatId);
  if (!p) return false;
  try {
    if (p.op === "split") {
      await tgSendMessage(chatId, `✂️ Separando páginas <code>${escapeHtml(text)}</code>...`);
      const { bytes } = await tgGetFileBuffer(p.fileId);
      const out = await splitPdf(bytes, text);
      const base = p.filename.replace(/\.[^.]+$/, "") || "documento";
      await tgSendDocument(chatId, new Blob([out], { type: "application/pdf" }), `${base}-paginas.pdf`);
    } else if (p.op === "resize") {
      const w = parseInt(text.trim(), 10);
      if (!Number.isFinite(w)) throw new Error("Largura inválida.");
      await tgSendMessage(chatId, `📏 Redimensionando para ${w}px...`);
      const { bytes } = await tgGetFileBuffer(p.fileId);
      const out = await resizeImage(bytes, w, p.mime);
      const base = p.filename.replace(/\.[^.]+$/, "") || "imagem";
      const ext = (p.mime || "").includes("png") ? "png" : "jpg";
      const outMime = ext === "png" ? "image/png" : "image/jpeg";
      await tgSendDocument(chatId, new Blob([out], { type: outMime }), `${base}-${w}px.${ext}`);
    }
  } catch (e) {
    await tgSendMessage(chatId, `❌ ${e instanceof Error ? e.message : "erro"}`);
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Auth do webhook
  try {
    const expected = await deriveWebhookSecret();
    const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!safeEqual(got, expected)) {
      return new Response("Unauthorized", { status: 401 });
    }
  } catch (e) {
    console.error("auth err:", e);
    return new Response("Server error", { status: 500 });
  }

  let update: TelegramUpdate;
  try { update = await req.json(); } catch { return new Response("ok"); }

  if (typeof update.update_id === "number" && dedupe(update.update_id)) {
    return new Response(JSON.stringify({ ok: true }));
  }

  // Callback query
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    if (!chatId) return new Response("ok");
    if (!isAllowed(chatId)) { return new Response(JSON.stringify({ ok: true })); }
    await tgAnswerCallback(cq.id);
    try { await handleCallback(chatId, cq.data ?? ""); }
    catch (e) { console.error("cb err:", e); await tgSendMessage(chatId, `❌ ${e instanceof Error ? e.message : "erro"}`); }
    return new Response(JSON.stringify({ ok: true }));
  }

  const msg = update.message ?? update.edited_message;
  if (!msg) return new Response(JSON.stringify({ ok: true }));

  const chatId = msg.chat?.id;
  if (!chatId) return new Response("ok");

  // Allowlist (sempre log do chat_id para o usuário descobrir)
  if (!isAllowed(chatId)) {
    console.log(`[telegram-webhook] mensagem de chat_id NÃO autorizado: ${chatId} (user: ${msg.from?.username ?? msg.from?.id})`);
    return new Response(JSON.stringify({ ok: true }));
  }

  try {
    // Áudio / voice
    if (msg.voice) {
      await handleAudio(chatId, msg.voice.file_id, msg.voice.mime_type);
      return new Response(JSON.stringify({ ok: true }));
    }
    if (msg.audio) {
      await handleAudio(chatId, msg.audio.file_id, msg.audio.mime_type);
      return new Response(JSON.stringify({ ok: true }));
    }

    // Document/photo → menu
    if (msg.document) {
      const m = await fileTypeMenu(chatId, msg.document.file_id, msg.document.mime_type ?? "", msg.document.file_name ?? "arquivo");
      await tgSendMessage(chatId, m.text, { reply_markup: m.keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }
    if (msg.photo?.length) {
      const best = msg.photo[msg.photo.length - 1];
      const m = await fileTypeMenu(chatId, best.file_id, "image/jpeg", `foto_${best.file_unique_id}.jpg`);
      await tgSendMessage(chatId, m.text, { reply_markup: m.keyboard });
      return new Response(JSON.stringify({ ok: true }));
    }

    // Texto / comando
    if (typeof msg.text === "string") {
      if (await handlePendingText(chatId, msg.text)) {
        return new Response(JSON.stringify({ ok: true }));
      }
      if (msg.text.startsWith("/")) {
        await handleCommand(chatId, msg.text);
      } else {
        await tgSendMessage(chatId, "Não sou IA conversacional ainda 🙂\nUse /help para ver os comandos.");
      }
      return new Response(JSON.stringify({ ok: true }));
    }

    return new Response(JSON.stringify({ ok: true }));
  } catch (e) {
    console.error("handler err:", e);
    try { await tgSendMessage(chatId, `❌ Erro interno: ${e instanceof Error ? e.message : "desconhecido"}`); } catch { /* Telegram inacessível */ }
    return new Response(JSON.stringify({ ok: true }));
  }
});