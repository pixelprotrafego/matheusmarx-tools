import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  argsDeCompressao, getVoiceStatus, LIMITE_DE_ENVIO, prepararAudioParaEnvio,
  resetVoiceStatusForTests, synthesize, transcribe,
} from "@/lib/voice-api";

const respostaJson = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

beforeEach(resetVoiceStatusForTests);
afterEach(() => vi.unstubAllGlobals());

describe("getVoiceStatus", () => {
  it("disponível quando o servidor responde com a chave configurada", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ ok: true, voice: true })));
    expect(await getVoiceStatus()).toEqual({ available: true });
  });

  it("sem chave quando o servidor existe mas falta GROQ_API_KEY", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respostaJson({ ok: true, voice: false })));
    expect(await getVoiceStatus()).toEqual({ available: false, reason: "not-configured" });
  });

  it("sem servidor quando /api/health devolve o index.html (Docker, npm run dev)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } })));
    expect(await getVoiceStatus()).toEqual({ available: false, reason: "no-server" });
  });

  it("sem servidor quando a rede falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await getVoiceStatus()).toEqual({ available: false, reason: "no-server" });
  });

  it("pergunta uma vez só por visita", async () => {
    const f = vi.fn(async () => respostaJson({ ok: true, voice: true }));
    vi.stubGlobal("fetch", f);
    await getVoiceStatus();
    await getVoiceStatus();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("transcribe / synthesize", () => {
  it("manda o arquivo e as opções para /api/transcribe no mesmo domínio", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => respostaJson({ text: "oi" }));
    vi.stubGlobal("fetch", f);
    const r = await transcribe(new File(["x"], "a.webm"), { language: "pt", withTimestamps: false });

    expect(r.text).toBe("oi");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("/api/transcribe");
    const form = init!.body as FormData;
    expect(form.get("language")).toBe("pt");
    expect(form.get("response_format")).toBe("json");
  });

  it("erro de limite chega com código e tempo de espera", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      respostaJson({ error: "limite", code: "rate_limited", resetInMs: 5000 }, 429)));
    await expect(transcribe(new File(["x"], "a.webm"), { language: "auto", withTimestamps: true }))
      .rejects.toMatchObject({ code: "rate_limited", resetInMs: 5000 });
  });

  it("413 da plataforma vira mensagem legível", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Request Entity Too Large", { status: 413 })));
    await expect(transcribe(new File(["x"], "a.webm"), { language: "auto", withTimestamps: true }))
      .rejects.toThrow(/limite de envio/);
  });

  it("texto para fala devolve o áudio", async () => {
    // Bytes, e não um Blob: o Blob do jsdom não é o mesmo do Response do Node,
    // e viraria a string "[object Blob]" no corpo.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 })));
    const blob = await synthesize({ text: "hi", voice: "mia", format: "wav" });
    expect(blob.size).toBe(4);
  });
});

describe("compressão antes do envio", () => {
  it("arquivo dentro do limite vai como está, sem carregar o ffmpeg", async () => {
    const pequeno = new File([new Uint8Array(1024)], "nota.m4a");
    expect(await prepararAudioParaEnvio(pequeno)).toBe(pequeno);
  });

  it("o limite cabe no teto de 4,5 MB da Vercel, com folga para o multipart", () => {
    expect(LIMITE_DE_ENVIO).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("comprime para Opus mono 16 kHz, que é o que o Whisper usa", () => {
    const args = argsDeCompressao("in.mp3", "out.ogg", 16);
    expect(args).toEqual(expect.arrayContaining(["-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "16k"]));
    expect(args.at(-1)).toBe("out.ogg");
  });
});
