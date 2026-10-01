// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as transcrever } from "../transcribe.js";
import { POST as falar } from "../tts.js";
import { GET as saude } from "../health.js";
import { ORIGEM, prepararAmbiente, respostaJson, simularRede } from "./helpers.js";

function pedidoDeTranscricao(extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(2048)], "voz.webm", { type: "audio/webm" }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new Request(`${ORIGEM}/api/transcribe`, {
    method: "POST",
    body: form,
    headers: { origin: ORIGEM, "x-real-ip": "1.1.1.1", ...headers },
  });
}

const pedidoDeFala = (corpo: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGEM}/api/tts`, {
    method: "POST",
    body: JSON.stringify(corpo),
    headers: { "Content-Type": "application/json", origin: ORIGEM, "x-real-ip": "1.1.1.1", ...headers },
  });

/** Corpo JSON de erro das rotas. */
const corpoDe = async (res: Response) =>
  (await res.json()) as { error?: string; code?: string; scope?: string; resetInMs?: number };

beforeEach(prepararAmbiente);
afterEach(() => vi.unstubAllGlobals());

describe("POST /api/transcribe", () => {
  it("manda o áudio à Groq com os parâmetros escolhidos e devolve o resultado", async () => {
    const chamadas = simularRede([
      [/groq\.com.*transcriptions/, () => respostaJson({ text: "olá mundo", language: "pt", duration: 1.5, segments: [] })],
    ]);

    const res = await transcrever(pedidoDeTranscricao({ language: "pt", response_format: "verbose_json" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ text: "olá mundo", language: "pt", duration: 1.5 });

    const enviado = chamadas[0].body as FormData;
    expect(enviado.get("language")).toBe("pt");
    expect(enviado.get("model")).toBe("whisper-large-v3");
    expect((enviado.get("file") as File).name).toBe("voz.webm");
  });

  it("'auto' não manda idioma, para o Whisper detectar", async () => {
    const chamadas = simularRede([[/groq\.com/, () => respostaJson({ text: "x" })]]);
    await transcrever(pedidoDeTranscricao({ language: "auto" }));
    expect((chamadas[0].body as FormData).has("language")).toBe(false);
  });

  it("recusa outro site usando a função pelo navegador do visitante", async () => {
    const res = await transcrever(pedidoDeTranscricao({}, { origin: "https://site-alheio.com" }));
    expect(res.status).toBe(403);
  });

  it("explica quando falta o arquivo", async () => {
    const form = new FormData();
    form.append("language", "pt");
    const res = await transcrever(new Request(`${ORIGEM}/api/transcribe`, { method: "POST", body: form }));
    expect(res.status).toBe(400);
    expect((await corpoDe(res)).error).toMatch(/file/);
  });

  it("recusa modelo fora da lista", async () => {
    const res = await transcrever(pedidoDeTranscricao({ model: "gpt-qualquer" }));
    expect(res.status).toBe(400);
  });

  it("a 11ª chamada na mesma hora recebe 429 com o tempo de espera", async () => {
    simularRede([[/groq\.com/, () => respostaJson({ text: "x" })]]);
    for (let i = 0; i < 10; i++) expect((await transcrever(pedidoDeTranscricao())).status).toBe(200);

    const res = await transcrever(pedidoDeTranscricao());
    expect(res.status).toBe(429);
    const corpo = await corpoDe(res);
    expect(corpo).toMatchObject({ code: "rate_limited", scope: "hourly" });
    expect(corpo.resetInMs).toBeGreaterThan(0);
  });

  it("falha da Groq vira 502 com a mensagem, sem derrubar a função", async () => {
    simularRede([[/groq\.com/, () => new Response("sem créditos", { status: 402 })]]);
    const res = await transcrever(pedidoDeTranscricao());
    expect(res.status).toBe(502);
    expect((await corpoDe(res)).error).toMatch(/402/);
  });
});

describe("POST /api/tts", () => {
  it("devolve o áudio com o tipo certo", async () => {
    simularRede([[/groq\.com.*speech/, () => new Response(new Uint8Array([82, 73, 70, 70]))]]);
    const res = await falar(pedidoDeFala({ text: "Hello", voice: "mia", format: "mp3" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
  });

  it("valida voz, formato e texto antes de gastar a cota da Groq", async () => {
    const chamadas = simularRede([]);
    expect((await falar(pedidoDeFala({ text: "Hi", voice: "darth" }))).status).toBe(400);
    expect((await falar(pedidoDeFala({ text: "Hi", format: "aac" }))).status).toBe(400);
    expect((await falar(pedidoDeFala({ text: "   " }))).status).toBe(400);
    expect((await falar(pedidoDeFala({ text: "a".repeat(4001) }))).status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it("modelo com termos não aceitos vira 503 com código próprio", async () => {
    simularRede([[/groq\.com/, () => new Response('{"error":{"code":"model_terms_required"}}', { status: 400 })]]);
    const res = await falar(pedidoDeFala({ text: "Hi" }));
    expect(res.status).toBe(503);
    expect((await corpoDe(res)).code).toBe("model_terms_required");
  });
});

describe("GET /api/health", () => {
  it("diz se a voz está disponível sem revelar a chave", async () => {
    const corpo = await saude().json();
    expect(corpo).toEqual({ ok: true, voice: true });

    delete process.env.GROQ_API_KEY;
    expect(await saude().json()).toEqual({ ok: true, voice: false });
  });
});
