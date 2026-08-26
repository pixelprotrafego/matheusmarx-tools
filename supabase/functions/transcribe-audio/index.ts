import { corsHeaders } from "../_shared/cors.ts";
import { groqTranscribe } from "../_shared/groq.ts";
import { checkIpLimit, isAllowedOrigin } from "../_shared/rate-limit.ts";

const MAX_BYTES = 25 * 1024 * 1024; // Groq limit
const ALLOWED_MODELS = new Set(["whisper-large-v3", "whisper-large-v3-turbo"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!isAllowedOrigin(req)) {
    return new Response(JSON.stringify({ error: "origem não permitida" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rl = await checkIpLimit(req, "transcribe", 10, 30);
  if (!rl.ok) {
    return new Response(JSON.stringify({
      error: "limite de requisições atingido",
      code: "rate_limited",
      resetInMs: rl.resetInMs,
      scope: rl.scope,
    }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len && len > MAX_BYTES + 1024) {
      return new Response(JSON.stringify({ error: "Arquivo excede 25 MB." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Campo 'file' ausente." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (file.size > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "Arquivo excede 25 MB." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const language = (form.get("language") as string | null) ?? undefined;
    const responseFormat = ((form.get("response_format") as string | null) ?? "verbose_json") as
      | "json" | "verbose_json" | "text";
    const model = (form.get("model") as string | null) ?? undefined;
    if (model && !ALLOWED_MODELS.has(model)) {
      return new Response(
        JSON.stringify({ error: `modelo inválido. Permitidos: ${[...ALLOWED_MODELS].join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await groqTranscribe({
      file,
      filename: file.name || "audio",
      language: language ?? undefined,
      responseFormat,
      model: model ?? undefined,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("transcribe-audio error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});