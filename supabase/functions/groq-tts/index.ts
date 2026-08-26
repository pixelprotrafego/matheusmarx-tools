import { corsHeaders } from "../_shared/cors.ts";
import { groqSpeech } from "../_shared/groq.ts";
import { checkIpLimit, isAllowedOrigin } from "../_shared/rate-limit.ts";

const ALLOWED_VOICES = new Set([
  "austin","leo","dan","mia","zoe","jess","tara","leah",
]);
const ALLOWED_FORMATS = new Set(["wav","mp3","flac","opus"]);
const MAX_CHARS = 4000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isAllowedOrigin(req)) return j({ error: "origem não permitida" }, 403);

  const rl = await checkIpLimit(req, "tts", 10, 30);
  if (!rl.ok) {
    return j({ error: "limite de requisições atingido", code: "rate_limited", resetInMs: rl.resetInMs, scope: rl.scope }, 429);
  }

  let body: { text?: unknown; voice?: unknown; format?: unknown };
  try { body = await req.json(); }
  catch { return j({ error: "JSON inválido" }, 400); }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voice = typeof body.voice === "string" && body.voice ? body.voice : "austin";
  const format = typeof body.format === "string" && body.format ? body.format : "wav";

  if (!text) return j({ error: "campo 'text' obrigatório" }, 400);
  if (text.length > MAX_CHARS) return j({ error: `texto excede ${MAX_CHARS} caracteres` }, 400);
  if (!ALLOWED_VOICES.has(voice)) return j({ error: `voz inválida: ${voice}` }, 400);
  if (!ALLOWED_FORMATS.has(format)) return j({ error: `formato inválido: ${format}` }, 400);

  try {
    const r = await groqSpeech({ text, voice, format: format as "wav" | "mp3" | "flac" | "opus" });
    return new Response(r.bytes, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": r.mime,
        "Content-Disposition": `attachment; filename="speech.${r.ext}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("groq-tts:", e);
    const code = (e as { code?: string })?.code;
    if (code === "model_terms_required") {
      return j({
        error: e instanceof Error ? e.message : "modelo indisponível",
        code,
      }, 503);
    }
    return j({ error: e instanceof Error ? e.message : "erro desconhecido" }, 500);
  }
});

function j(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}