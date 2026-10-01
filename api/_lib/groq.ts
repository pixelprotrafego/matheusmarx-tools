/**
 * Cliente da API da Groq: transcrição (Whisper) e texto para fala (Orpheus).
 *
 * Docs: https://console.groq.com/docs/speech-to-text
 *       https://console.groq.com/docs/text-to-speech
 */

const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TTS_URL = "https://api.groq.com/openai/v1/audio/speech";

function chave(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY não configurada no servidor.");
  return key;
}

/** Diz se a chave existe, sem expô-la — usado pelo `/api/health`. */
export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// ---------------------------------------------------------------- transcrição

export interface GroqTranscribeOpts {
  file: Blob;
  filename: string;
  model?: string;
  /** ISO-639-1, ex. "pt". "auto" ou ausente deixa o Whisper detectar. */
  language?: string;
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
}

export async function groqTranscribe(opts: GroqTranscribeOpts): Promise<GroqTranscribeResult> {
  const fd = new FormData();
  fd.append("file", opts.file, opts.filename);
  fd.append("model", opts.model ?? "whisper-large-v3");
  if (opts.language && opts.language !== "auto") fd.append("language", opts.language);
  fd.append("response_format", opts.responseFormat ?? "verbose_json");
  fd.append("temperature", String(opts.temperature ?? 0));
  if (opts.prompt) fd.append("prompt", opts.prompt);

  const res = await fetch(GROQ_STT_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave()}` },
    body: fd,
  });

  if (!res.ok) {
    const erro = await res.text();
    throw new Error(`Groq falhou [${res.status}]: ${erro.slice(0, 500)}`);
  }

  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const data = (await res.json()) as GroqTranscribeResult;
    return {
      text: data.text ?? "",
      language: data.language,
      duration: data.duration,
      segments: data.segments,
    };
  }
  return { text: await res.text() };
}

// --------------------------------------------------------------- texto → fala

export const TTS_VOICES = ["austin", "leo", "dan", "mia", "zoe", "jess", "tara", "leah"] as const;
export const TTS_FORMATS = ["wav", "mp3", "flac", "opus"] as const;
export type TtsFormat = (typeof TTS_FORMATS)[number];

export interface GroqSpeechResult {
  bytes: Uint8Array;
  mime: string;
  ext: TtsFormat;
}

const MIME_DO_FORMATO: Record<TtsFormat, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  opus: "audio/ogg",
};

/** Erro com código, para a camada HTTP distinguir "modelo bloqueado" de falha comum. */
export class GroqError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function groqSpeech(opts: {
  text: string;
  voice?: string;
  format?: TtsFormat;
  model?: string;
}): Promise<GroqSpeechResult> {
  const format = opts.format ?? "wav";
  const res = await fetch(GROQ_TTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? "canopylabs/orpheus-v1-english",
      input: opts.text,
      voice: opts.voice ?? "austin",
      response_format: format,
    }),
  });

  if (!res.ok) {
    const erro = await res.text();
    // O Orpheus exige que o admin da organização aceite os termos do modelo
    // no console da Groq. Sem isso a API devolve 400 com este código.
    if (res.status === 400 && /model_terms_required/i.test(erro)) {
      throw new GroqError(
        "O modelo de voz Orpheus exige aceite de termos no provedor (Groq). " +
          "Peça ao admin da organização para aceitar em " +
          "https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english",
        "model_terms_required",
      );
    }
    throw new GroqError(`Groq TTS falhou [${res.status}]: ${erro.slice(0, 500)}`);
  }

  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: MIME_DO_FORMATO[format],
    ext: format,
  };
}
