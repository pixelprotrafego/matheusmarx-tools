import { errorMessage, isSameOrigin, json } from "./_lib/http.js";
import { checkIpLimit } from "./_lib/rate-limit.js";
import { GroqError, groqSpeech, TTS_FORMATS, TTS_VOICES, type TtsFormat } from "./_lib/groq.js";

const MAX_CHARS = 4000;

/**
 * POST /api/tts — texto para fala.
 *
 * Corpo JSON: `{ text, voice?, format? }`. Devolve o áudio binário.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return json({ error: "origem não permitida" }, 403);

  const limite = await checkIpLimit(req, "tts", 10, 30);
  if (!limite.ok) {
    return json(
      { error: "limite de requisições atingido", code: "rate_limited", resetInMs: limite.resetInMs, scope: limite.scope },
      429,
    );
  }

  let corpo: { text?: unknown; voice?: unknown; format?: unknown };
  try {
    corpo = (await req.json()) as typeof corpo;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const texto = typeof corpo.text === "string" ? corpo.text.trim() : "";
  const voz = typeof corpo.voice === "string" && corpo.voice ? corpo.voice : "austin";
  const formato = typeof corpo.format === "string" && corpo.format ? corpo.format : "wav";

  if (!texto) return json({ error: "campo 'text' obrigatório" }, 400);
  if (texto.length > MAX_CHARS) return json({ error: `texto excede ${MAX_CHARS} caracteres` }, 400);
  if (!(TTS_VOICES as readonly string[]).includes(voz)) return json({ error: `voz inválida: ${voz}` }, 400);
  if (!(TTS_FORMATS as readonly string[]).includes(formato)) return json({ error: `formato inválido: ${formato}` }, 400);

  try {
    const r = await groqSpeech({ text: texto, voice: voz, format: formato as TtsFormat });
    return new Response(r.bytes, {
      status: 200,
      headers: {
        "Content-Type": r.mime,
        "Content-Disposition": `attachment; filename="speech.${r.ext}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[tts]", errorMessage(e));
    if (e instanceof GroqError && e.code === "model_terms_required") {
      return json({ error: e.message, code: e.code }, 503);
    }
    return json({ error: errorMessage(e) }, 502);
  }
}
