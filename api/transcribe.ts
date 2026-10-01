import { errorMessage, isSameOrigin, json } from "./_lib/http.js";
import { checkIpLimit } from "./_lib/rate-limit.js";
import { groqTranscribe } from "./_lib/groq.js";

/** Limite da Groq. Na Vercel a plataforma corta antes, em 4,5 MB por requisição. */
const MAX_BYTES = 25 * 1024 * 1024;
const MODELOS = new Set(["whisper-large-v3", "whisper-large-v3-turbo"]);
const FORMATOS = new Set(["json", "verbose_json", "text"]);

/**
 * POST /api/transcribe — transcrição de áudio enviada pelo site.
 *
 * Corpo `multipart/form-data`: `file` (obrigatório), `language`,
 * `response_format` e `model` (opcionais).
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSameOrigin(req)) return json({ error: "origem não permitida" }, 403);

  const limite = await checkIpLimit(req, "transcribe", 10, 30);
  if (!limite.ok) {
    return json(
      { error: "limite de requisições atingido", code: "rate_limited", resetInMs: limite.resetInMs, scope: limite.scope },
      429,
    );
  }

  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (declarado > MAX_BYTES + 1024) return json({ error: "Arquivo excede 25 MB." }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "Corpo inválido: envie multipart/form-data com o campo 'file'." }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof Blob)) return json({ error: "Campo 'file' ausente." }, 400);
  if (file.size > MAX_BYTES) return json({ error: "Arquivo excede 25 MB." }, 413);

  const model = (form.get("model") as string | null) || undefined;
  if (model && !MODELOS.has(model)) {
    return json({ error: `modelo inválido. Permitidos: ${[...MODELOS].join(", ")}` }, 400);
  }
  const formato = (form.get("response_format") as string | null) || "verbose_json";
  if (!FORMATOS.has(formato)) return json({ error: `formato inválido: ${formato}` }, 400);

  try {
    const resultado = await groqTranscribe({
      file,
      filename: (file as File).name || "audio",
      language: (form.get("language") as string | null) || undefined,
      responseFormat: formato as "json" | "verbose_json" | "text",
      model,
    });
    return json(resultado);
  } catch (e) {
    console.error("[transcribe]", errorMessage(e));
    return json({ error: errorMessage(e) }, 502);
  }
}
