// Helper de transcrição via Groq Whisper.
// Documentação: https://console.groq.com/docs/speech-to-text

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export interface GroqTranscribeOpts {
  file: Blob;
  filename: string;
  model?: string;            // default whisper-large-v3
  language?: string;         // ISO-639-1, ex "pt"
  responseFormat?: "json" | "verbose_json" | "text";
  temperature?: number;
  prompt?: string;
}

export interface GroqVerboseSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface GroqTranscribeResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: GroqVerboseSegment[];
  raw: unknown;
}

export async function groqTranscribe(opts: GroqTranscribeOpts): Promise<GroqTranscribeResult> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY não configurada no servidor.");

  const fd = new FormData();
  fd.append("file", opts.file, opts.filename);
  fd.append("model", opts.model ?? "whisper-large-v3");
  if (opts.language && opts.language !== "auto") fd.append("language", opts.language);
  fd.append("response_format", opts.responseFormat ?? "verbose_json");
  fd.append("temperature", String(opts.temperature ?? 0));
  if (opts.prompt) fd.append("prompt", opts.prompt);

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: fd,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq falhou [${res.status}]: ${errText.slice(0, 500)}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    return {
      text: data.text ?? "",
      language: data.language,
      duration: data.duration,
      segments: data.segments,
      raw: data,
    };
  }
  const text = await res.text();
  return { text, raw: text };
}

// ------- Text-to-Speech (Orpheus) -------
// Docs: https://console.groq.com/docs/text-to-speech

const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";

export type GroqTtsVoice =
  | "austin" | "leo" | "dan" | "mia" | "zoe" | "jess" | "tara" | "leah";

export interface GroqSpeechOpts {
  text: string;
  voice?: GroqTtsVoice | string;
  format?: "wav" | "mp3" | "flac" | "opus";
  model?: string;
}

export interface GroqSpeechResult {
  bytes: Uint8Array;
  mime: string;
  ext: string;
}

export async function groqSpeech(opts: GroqSpeechOpts): Promise<GroqSpeechResult> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) throw new Error("GROQ_API_KEY não configurada no servidor.");

  const format = opts.format ?? "wav";
  const body = {
    model: opts.model ?? "canopylabs/orpheus-v1-english",
    input: opts.text,
    voice: opts.voice ?? "austin",
    response_format: format,
  };

  const res = await fetch(GROQ_TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    // Detecta o caso "termos do modelo não aceitos" e devolve um erro amigável.
    if (res.status === 400 && /model_terms_required/i.test(errText)) {
      const err = new Error(
        "O modelo de voz Orpheus exige aceite de termos no provedor (Groq). " +
        "Peça ao admin da organização para aceitar em https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english"
      );
      (err as Error & { code?: string }).code = "model_terms_required";
      throw err;
    }
    throw new Error(`Groq TTS falhou [${res.status}]: ${errText.slice(0, 500)}`);
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  const mime =
    format === "wav" ? "audio/wav" :
    format === "mp3" ? "audio/mpeg" :
    format === "flac" ? "audio/flac" : "audio/ogg";
  return { bytes: buf, mime, ext: format };
}