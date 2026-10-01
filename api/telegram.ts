import { errorMessage, json } from "./_lib/http.js";
import {
  chunks, deriveWebhookSecret, escapeHtml, isAllowedChat, safeEqual,
  tgAnswerCallback, tgGetFileBuffer, tgSendDocument, tgSendMessage, tgSendPhoto,
} from "./_lib/telegram.js";
import { claimUpdate, getFile, putFile, setPending, takePending } from "./_lib/telegram-state.js";
import { runCommand } from "./_lib/commands.js";
import { groqTranscribe } from "./_lib/groq.js";
import { pdfInfo, pdfToDocx, pdfToText, rotatePdf, splitPdf } from "./_lib/pdf-ops.js";
import { convertImage, imageToPdf, resizeImage, type ImageTarget } from "./_lib/image-ops.js";
import { docxToText, xlsxToText } from "./_lib/doc-ops.js";

/**
 * POST /api/telegram — webhook do bot.
 *
 * O Telegram chama esta rota a cada mensagem. A autenticação é o segredo que
 * ele devolve no cabeçalho `X-Telegram-Bot-Api-Secret-Token`, registrado junto
 * com o webhook por `npm run telegram set <url>`.
 *
 * Sempre responde 200 depois de autenticado, mesmo quando algo falha lá
 * dentro: qualquer outra resposta faz o Telegram reenviar o mesmo update em
 * laço. As falhas chegam à pessoa como mensagem no chat.
 */

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
  callback_query?: { id: string; data?: string; message?: { chat?: { id: number } } };
}

const OK = () => json({ ok: true });
const semExtensao = (nome: string, padrao: string) => nome.replace(/\.[^.]+$/, "") || padrao;

/** Manda um texto longo em vários pedaços, com um prefixo em cada um. */
async function enviarEmPartes(chatId: number, texto: string, embrulho: (parte: string) => string) {
  for (const parte of chunks(texto)) await tgSendMessage(chatId, embrulho(escapeHtml(parte)));
}

// ------------------------------------------------------------------- comandos

async function handleCommand(chatId: number, texto: string) {
  const limpo = texto.trim();
  const espaco = limpo.indexOf(" ");
  // "/help@MeuBot" vira "/help": é como o comando chega em grupos.
  const cmd = (espaco === -1 ? limpo : limpo.slice(0, espaco)).split("@")[0].toLowerCase();
  const args = espaco === -1 ? "" : limpo.slice(espaco + 1);

  const r = await runCommand(cmd, args);
  if (r.blob && r.filename) {
    const enviar = r.asPhoto ? tgSendPhoto : tgSendDocument;
    await enviar(chatId, r.blob, r.filename, r.text);
  } else if (r.text) {
    await tgSendMessage(chatId, r.text);
  }
}

// ----------------------------------------------------------------- transcrição

/**
 * Nome com a extensão que a Groq aceita.
 *
 * A Groq aceita flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav e webm. A voz
 * do Telegram chega como `.oga` — que é OGG/Opus, mas com uma extensão que a
 * Groq recusa — e por isso vira `.ogg`.
 */
function nomeDeAudio(caminho: string, mime?: string): string {
  const base = semExtensao(caminho.split("/").pop() || "audio", "audio");
  const m = (mime || "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus") || /\.oga$/i.test(caminho)) return `${base}.ogg`;
  if (m.includes("mpeg") || m.includes("mp3")) return `${base}.mp3`;
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return `${base}.m4a`;
  if (m.includes("wav")) return `${base}.wav`;
  if (m.includes("webm")) return `${base}.webm`;
  if (m.includes("flac")) return `${base}.flac`;
  return `${base}.ogg`;
}

async function handleAudio(chatId: number, fileId: string, mime?: string) {
  await tgSendMessage(chatId, "🎙️ Baixando e transcrevendo...");
  try {
    const { bytes, path } = await tgGetFileBuffer(fileId);
    const r = await groqTranscribe({
      file: new Blob([bytes], { type: mime || "audio/ogg" }),
      filename: nomeDeAudio(path, mime),
      responseFormat: "json",
      temperature: 0,
    });
    const texto = (r.text || "").trim() || "(sem fala detectada)";
    await enviarEmPartes(chatId, texto, (p) => `📝 <i>Transcrição:</i>\n\n${p}`);
  } catch (e) {
    await tgSendMessage(chatId, `❌ Falha ao transcrever: ${escapeHtml(errorMessage(e, "erro"))}`);
  }
}

// ------------------------------------------------------- menu de arquivos

async function menuDoArquivo(chatId: number, fileId: string, mime: string, filename: string) {
  const ehPdf = mime === "application/pdf" || /\.pdf$/i.test(filename);
  const ehImagem = mime.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(filename);
  const ehAudio = mime.startsWith("audio/") || /\.(mp3|m4a|wav|ogg|opus|flac|oga)$/i.test(filename);
  const ehDocx = /officedocument\.wordprocessingml/.test(mime) || /\.docx$/i.test(filename);
  const ehXlsx = /spreadsheetml/.test(mime) || /\.xlsx$/i.test(filename);

  const cabecalho = `Recebi <b>${escapeHtml(filename)}</b> (${escapeHtml(mime || "tipo desconhecido")}).`;
  if (!ehPdf && !ehImagem && !ehAudio && !ehDocx && !ehXlsx) {
    await tgSendMessage(chatId, `${cabecalho}\nFormato ainda não suportado pelo bot.`);
    return;
  }

  const key = await putFile({ fileId, mime, filename });
  const linhas: [string, string][][] = ehPdf
    ? [
        [["📝 Extrair texto", `p:${key}`], ["📄 → Word (.docx)", `pd:${key}`]],
        [["✂️ Separar páginas", `ps:${key}`], ["🔄 Rotacionar 90°", `pr:${key}`]],
        [["📊 Info do PDF", `pi:${key}`]],
      ]
    : ehImagem
      ? [
          [["🖼️ → PNG", `ic:${key}:png`], ["🖼️ → JPG", `ic:${key}:jpeg`], ["🖼️ → WebP", `ic:${key}:webp`]],
          [["📏 Redimensionar", `iz:${key}`], ["📄 → PDF", `ip:${key}`]],
        ]
      : ehAudio
        ? [[["🎙️ Transcrever", `t:${key}`]]]
        : ehDocx
          ? [[["📝 Extrair texto", `dx:${key}`]]]
          : [[["📝 Extrair texto (CSV)", `xl:${key}`]]];

  await tgSendMessage(chatId, `${cabecalho}\nO que deseja fazer?`, {
    reply_markup: {
      inline_keyboard: linhas.map((linha) => linha.map(([text, callback_data]) => ({ text, callback_data }))),
    },
  });
}

async function handleCallback(chatId: number, data: string) {
  const [op, key, arg] = data.split(":");
  const item = await getFile(key);
  if (!item) {
    await tgSendMessage(chatId, "⏱️ Ação expirou. Reenvie o arquivo.");
    return;
  }
  const baixar = async () => (await tgGetFileBuffer(item.fileId)).bytes;

  try {
    switch (op) {
      case "t":
        await handleAudio(chatId, item.fileId, item.mime);
        return;

      case "p": {
        await tgSendMessage(chatId, "📝 Extraindo texto do PDF...");
        const texto = (await pdfToText(await baixar())) || "(PDF sem texto extraível — pode ser imagem escaneada)";
        await enviarEmPartes(chatId, texto, (p) => `📄 ${p}`);
        return;
      }
      case "pd": {
        await tgSendMessage(chatId, "📄 Convertendo PDF para Word...");
        const docx = await pdfToDocx(await baixar());
        await tgSendDocument(
          chatId,
          new Blob([docx], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
          `${semExtensao(item.filename, "documento")}.docx`,
        );
        return;
      }
      case "ps":
        await setPending(chatId, { op: "split", ...item });
        await tgSendMessage(chatId, "✂️ Envie o range das páginas. Ex.: <code>1-3,5,8-10</code>");
        return;
      case "pr": {
        await tgSendMessage(chatId, "🔄 Rotacionando...");
        const pdf = await rotatePdf(await baixar(), 90);
        await tgSendDocument(chatId, new Blob([pdf], { type: "application/pdf" }), `${semExtensao(item.filename, "documento")}-rotacionado.pdf`);
        return;
      }
      case "pi":
        await tgSendMessage(chatId, await pdfInfo(await baixar()));
        return;

      case "ic": {
        const alvo = arg as ImageTarget;
        await tgSendMessage(chatId, `🖼️ Convertendo para ${alvo.toUpperCase()}...`);
        const r = await convertImage(await baixar(), alvo);
        const legenda = alvo === "webp" ? "(WebP indisponível no servidor — enviado como PNG, sem perda)" : undefined;
        await tgSendDocument(chatId, new Blob([r.bytes], { type: r.mime }), `${semExtensao(item.filename, "imagem")}.${r.ext}`, legenda);
        return;
      }
      case "iz":
        await setPending(chatId, { op: "resize", ...item });
        await tgSendMessage(chatId, "📏 Envie a largura em pixels. Ex.: <code>800</code>");
        return;
      case "ip": {
        await tgSendMessage(chatId, "📄 Gerando PDF...");
        const pdf = await imageToPdf(await baixar(), item.mime);
        await tgSendDocument(chatId, new Blob([pdf], { type: "application/pdf" }), `${semExtensao(item.filename, "imagem")}.pdf`);
        return;
      }

      case "dx": {
        await tgSendMessage(chatId, "📝 Extraindo texto do Word...");
        const texto = (await docxToText(await baixar())) || "(sem texto)";
        await enviarEmPartes(chatId, texto, (p) => `📄 ${p}`);
        return;
      }
      case "xl": {
        await tgSendMessage(chatId, "📝 Extraindo planilha...");
        const texto = xlsxToText(await baixar()) || "(planilha vazia)";
        await enviarEmPartes(chatId, texto, (p) => `📊 <pre>${p}</pre>`);
        return;
      }
    }
  } catch (e) {
    await tgSendMessage(chatId, `❌ ${escapeHtml(errorMessage(e, "erro"))}`);
  }
}

/** Resposta digitada para uma ação pendente. Devolve `false` se não havia nenhuma. */
async function handlePendingText(chatId: number, texto: string): Promise<boolean> {
  const pendente = await takePending(chatId);
  if (!pendente) return false;

  try {
    if (pendente.op === "split") {
      await tgSendMessage(chatId, `✂️ Separando páginas <code>${escapeHtml(texto)}</code>...`);
      const { bytes } = await tgGetFileBuffer(pendente.fileId);
      const pdf = await splitPdf(bytes, texto);
      await tgSendDocument(chatId, new Blob([pdf], { type: "application/pdf" }), `${semExtensao(pendente.filename, "documento")}-paginas.pdf`);
    } else {
      const largura = parseInt(texto.trim(), 10);
      if (!Number.isFinite(largura)) throw new Error("Largura inválida.");
      await tgSendMessage(chatId, `📏 Redimensionando para ${largura}px...`);
      const { bytes } = await tgGetFileBuffer(pendente.fileId);
      const img = await resizeImage(bytes, largura, pendente.mime);
      const ext = (pendente.mime || "").includes("png") ? "png" : "jpg";
      await tgSendDocument(
        chatId,
        new Blob([img], { type: ext === "png" ? "image/png" : "image/jpeg" }),
        `${semExtensao(pendente.filename, "imagem")}-${largura}px.${ext}`,
      );
    }
  } catch (e) {
    await tgSendMessage(chatId, `❌ ${escapeHtml(errorMessage(e, "erro"))}`);
  }
  return true;
}

// ------------------------------------------------------------------ entrada

export async function POST(req: Request): Promise<Response> {
  try {
    if (!safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), await deriveWebhookSecret())) {
      return new Response("Unauthorized", { status: 401 });
    }
  } catch (e) {
    console.error("[telegram] falha na autenticação:", errorMessage(e));
    return new Response("Server error", { status: 500 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return OK();
  }

  if (typeof update.update_id === "number" && !(await claimUpdate(update.update_id))) return OK();

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    if (!chatId || !isAllowedChat(chatId)) return OK();
    await tgAnswerCallback(cq.id).catch(() => undefined);
    await handleCallback(chatId, cq.data ?? "");
    return OK();
  }

  const msg = update.message ?? update.edited_message;
  const chatId = msg?.chat?.id;
  if (!msg || !chatId) return OK();

  if (!isAllowedChat(chatId)) {
    // Fica no log de propósito: é como quem instala descobre o próprio chat_id.
    console.log(`[telegram] chat_id NÃO autorizado: ${chatId} (user: ${msg.from?.username ?? msg.from?.id})`);
    return OK();
  }

  try {
    if (msg.voice) await handleAudio(chatId, msg.voice.file_id, msg.voice.mime_type);
    else if (msg.audio) await handleAudio(chatId, msg.audio.file_id, msg.audio.mime_type);
    else if (msg.document) {
      await menuDoArquivo(chatId, msg.document.file_id, msg.document.mime_type ?? "", msg.document.file_name ?? "arquivo");
    } else if (msg.photo?.length) {
      const maior = msg.photo[msg.photo.length - 1];
      await menuDoArquivo(chatId, maior.file_id, "image/jpeg", `foto_${maior.file_unique_id}.jpg`);
    } else if (typeof msg.text === "string") {
      if (await handlePendingText(chatId, msg.text)) return OK();
      if (msg.text.startsWith("/")) await handleCommand(chatId, msg.text);
      else await tgSendMessage(chatId, "Não sou IA conversacional ainda 🙂\nUse /help para ver os comandos.");
    }
  } catch (e) {
    console.error("[telegram] erro no processamento:", errorMessage(e));
    await tgSendMessage(chatId, `❌ Erro interno: ${escapeHtml(errorMessage(e))}`).catch(() => undefined);
  }
  return OK();
}
