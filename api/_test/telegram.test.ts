// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { POST as webhook } from "../telegram.js";
import { deriveWebhookSecret } from "../_lib/telegram.js";
import { HELP_TEXT } from "../_lib/commands.js";
import { prepararAmbiente, respostaJson, rotasTelegram, simularRede, textosEnviados } from "./helpers.js";

let proximoUpdate = 1000;

async function enviarUpdate(update: Record<string, unknown>, segredo?: string) {
  return webhook(
    new Request("https://tools.exemplo.com/api/telegram", {
      method: "POST",
      body: JSON.stringify({ update_id: proximoUpdate++, ...update }),
      headers: {
        "Content-Type": "application/json",
        "x-telegram-bot-api-secret-token": segredo ?? (await deriveWebhookSecret()),
      },
    }),
  );
}

const mensagem = (campos: Record<string, unknown>, chatId = 42) => ({ message: { chat: { id: chatId }, ...campos } });

beforeEach(prepararAmbiente);
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/telegram — autenticação e filtros", () => {
  it("o segredo bate com o que scripts/telegram-setup.mjs registra no Telegram", async () => {
    // Mesma fórmula do script, que usa node:crypto em vez de crypto.subtle.
    const doScript = createHash("sha256")
      .update(`telegram-webhook:${process.env.TELEGRAM_BOT_TOKEN}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(await deriveWebhookSecret()).toBe(doScript);
  });

  it("recusa quem não tem o segredo do webhook", async () => {
    const chamadas = simularRede(rotasTelegram());
    const res = await enviarUpdate(mensagem({ text: "/help" }), "segredo-errado");
    expect(res.status).toBe(401);
    expect(chamadas).toHaveLength(0);
  });

  it("ignora em silêncio quem não está na lista de chats autorizados", async () => {
    const chamadas = simularRede(rotasTelegram());
    const res = await enviarUpdate(mensagem({ text: "/help" }, 999));
    expect(res.status).toBe(200);
    expect(chamadas).toHaveLength(0);
  });

  it("o mesmo update reenviado pelo Telegram é processado uma vez só", async () => {
    const chamadas = simularRede(rotasTelegram());
    const segredo = await deriveWebhookSecret();
    const corpo = JSON.stringify({ update_id: 7, ...mensagem({ text: "/help" }) });
    const pedido = () =>
      new Request("https://x/api/telegram", { method: "POST", body: corpo, headers: { "x-telegram-bot-api-secret-token": segredo } });

    await webhook(pedido());
    await webhook(pedido());
    expect(textosEnviados(chamadas)).toHaveLength(1);
  });
});

describe("POST /api/telegram — comandos", () => {
  it("/help responde a ajuda", async () => {
    const chamadas = simularRede(rotasTelegram());
    await enviarUpdate(mensagem({ text: "/help" }));
    expect(textosEnviados(chamadas)).toEqual([HELP_TEXT]);
  });

  it("/calc usa a mesma calculadora do site e escapa o HTML da expressão", async () => {
    const chamadas = simularRede(rotasTelegram());
    await enviarUpdate(mensagem({ text: "/calc 2+2*5" }));
    expect(textosEnviados(chamadas)[0]).toContain("<code>12</code>");

    await enviarUpdate(mensagem({ text: "/calc 1<2" }));
    expect(textosEnviados(chamadas)[1]).not.toContain("1<2");
  });

  it("/conv converte entre unidades da mesma categoria", async () => {
    const chamadas = simularRede(rotasTelegram());
    await enviarUpdate(mensagem({ text: "/conv 100 C F" }));
    expect(textosEnviados(chamadas)[0]).toContain("212 F");
  });

  it("/qr devolve uma imagem PNG", async () => {
    const chamadas = simularRede(rotasTelegram());
    await enviarUpdate(mensagem({ text: "/qr https://exemplo.com" }));
    const foto = chamadas.find((c) => c.url.endsWith("/sendPhoto"));
    expect(foto).toBeDefined();
    const png = (foto!.body as FormData).get("photo") as Blob;
    expect(new Uint8Array(await png.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("/senha gera o tamanho pedido sem caracteres ambíguos", async () => {
    const chamadas = simularRede(rotasTelegram());
    await enviarUpdate(mensagem({ text: "/senha 40" }));
    const senha = textosEnviados(chamadas)[0].match(/<code>(.+?)<\/code>/)![1];
    expect(senha).toHaveLength(40);
    expect(senha).not.toMatch(/[lIoO01]/);
  });
});

describe("POST /api/telegram — áudio e arquivos", () => {
  it("mensagem de voz é baixada do Telegram, transcrita e devolvida", async () => {
    const chamadas = simularRede([
      [/groq\.com/, () => respostaJson({ text: "bom dia, teste de voz" })],
      ...rotasTelegram(new Uint8Array([79, 103, 103, 83])),
    ]);
    await enviarUpdate(mensagem({ voice: { file_id: "voz-1", mime_type: "audio/ogg" } }));

    const paraGroq = chamadas.find((c) => c.url.includes("groq.com"))!.body as FormData;
    // A voz chega como .oga, que a Groq recusa: tem que ir como .ogg.
    expect((paraGroq.get("file") as File).name).toBe("file_1.ogg");
    expect(textosEnviados(chamadas).at(-1)).toContain("bom dia, teste de voz");
  });

  it("falha da Groq chega à pessoa como mensagem, e o webhook responde 200", async () => {
    const chamadas = simularRede([[/groq\.com/, () => new Response("fora", { status: 503 })], ...rotasTelegram()]);
    const res = await enviarUpdate(mensagem({ voice: { file_id: "v" } }));
    expect(res.status).toBe(200);
    expect(textosEnviados(chamadas).at(-1)).toMatch(/Falha ao transcrever/);
  });

  it("PDF abre o menu, e o botão de info lê o arquivo de verdade", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    doc.addPage([595, 842]);
    const pdf = await doc.save();

    const chamadas = simularRede(rotasTelegram(pdf));
    await enviarUpdate(mensagem({ document: { file_id: "pdf-1", mime_type: "application/pdf", file_name: "contrato.pdf" } }));

    const menu = chamadas.find((c) => c.url.endsWith("/sendMessage"))!.body as {
      reply_markup: { inline_keyboard: { callback_data: string }[][] };
    };
    const botaoInfo = menu.reply_markup.inline_keyboard.flat().find((b) => b.callback_data.startsWith("pi:"))!;

    await enviarUpdate({ callback_query: { id: "cq", data: botaoInfo.callback_data, message: { chat: { id: 42 } } } });
    expect(textosEnviados(chamadas).at(-1)).toContain("Páginas: <b>2</b>");
  });

  it("separar páginas espera o intervalo digitado e devolve só aquelas páginas", async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 5; i++) doc.addPage();
    const chamadas = simularRede(rotasTelegram(await doc.save()));

    await enviarUpdate(mensagem({ document: { file_id: "pdf-2", mime_type: "application/pdf", file_name: "a.pdf" } }));
    const menu = chamadas.find((c) => c.url.endsWith("/sendMessage"))!.body as {
      reply_markup: { inline_keyboard: { callback_data: string }[][] };
    };
    const separar = menu.reply_markup.inline_keyboard.flat().find((b) => b.callback_data.startsWith("ps:"))!;

    await enviarUpdate({ callback_query: { id: "cq", data: separar.callback_data, message: { chat: { id: 42 } } } });
    await enviarUpdate(mensagem({ text: "2-3,5" }));

    const enviado = chamadas.find((c) => c.url.endsWith("/sendDocument"))!.body as FormData;
    const resultado = await PDFDocument.load(new Uint8Array(await (enviado.get("document") as Blob).arrayBuffer()));
    expect(resultado.getPageCount()).toBe(3);
  });

  it("botão de arquivo vencido avisa em vez de falhar", async () => {
    const chamadas = simularRede(rotasTelegram());
    await enviarUpdate({ callback_query: { id: "cq", data: "pi:naoexiste", message: { chat: { id: 42 } } } });
    expect(textosEnviados(chamadas).at(-1)).toMatch(/expirou/);
  });
});
