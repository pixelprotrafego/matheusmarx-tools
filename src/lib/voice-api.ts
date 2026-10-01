/**
 * Ponte do site com as funções de áudio em `api/`.
 *
 * Transcrição e texto para fala são a única parte do site que sai do
 * navegador: elas chamam `/api/transcribe` e `/api/tts` no mesmo domínio, que
 * por sua vez chamam a Groq. Não há chave nem endereço gravado no JavaScript —
 * as credenciais ficam só no servidor.
 */

/** Teto de corpo de requisição da Vercel é 4,5 MB; a folga cobre o envelope multipart. */
export const LIMITE_DE_ENVIO = 4 * 1024 * 1024;

/** Maior arquivo aceito antes de comprimir. Acima disso, o navegador sofre para processar. */
export const LIMITE_DE_ENTRADA = 200 * 1024 * 1024;

export interface ApiError extends Error {
  code?: string;
  resetInMs?: number;
}

// ------------------------------------------------------------- disponibilidade

export type VoiceStatus =
  | { available: true }
  | { available: false; reason: "no-server" | "not-configured" };

let consulta: Promise<VoiceStatus> | null = null;

/**
 * As ferramentas de áudio funcionam nesta instalação?
 *
 * Pergunta ao `/api/health`. Onde não existe servidor — a imagem Docker, que é
 * só um nginx, ou o `npm run dev` puro — a resposta não é o JSON esperado, e
 * as ferramentas se apresentam desligadas com o motivo, em vez de falhar no
 * clique. O resultado é guardado: a resposta não muda durante a visita.
 */
export function getVoiceStatus(): Promise<VoiceStatus> {
  consulta ??= (async (): Promise<VoiceStatus> => {
    try {
      const res = await fetch("/api/health", { headers: { Accept: "application/json" } });
      const tipo = res.headers.get("content-type") ?? "";
      if (!res.ok || !tipo.includes("application/json")) return { available: false, reason: "no-server" };
      const corpo = (await res.json()) as { ok?: boolean; voice?: boolean };
      if (!corpo.ok) return { available: false, reason: "no-server" };
      return corpo.voice ? { available: true } : { available: false, reason: "not-configured" };
    } catch {
      return { available: false, reason: "no-server" };
    }
  })();
  return consulta;
}

/** Descarta a resposta guardada — só para testes. */
export function resetVoiceStatusForTests() {
  consulta = null;
}

// ----------------------------------------------------------------- chamadas

async function erroDaResposta(res: Response): Promise<ApiError> {
  const corpo = (await res.json().catch(() => ({}))) as { error?: string; code?: string; resetInMs?: number };
  const mensagem =
    res.status === 413
      ? "O arquivo passou do limite de envio do servidor."
      : corpo.error || `Falha na requisição (HTTP ${res.status}).`;
  return Object.assign(new Error(mensagem), { code: corpo.code, resetInMs: corpo.resetInMs });
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegment[];
}

export async function transcribe(
  audio: File,
  opts: { language: string; withTimestamps: boolean },
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", audio, audio.name);
  form.append("language", opts.language);
  form.append("response_format", opts.withTimestamps ? "verbose_json" : "json");

  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw await erroDaResposta(res);
  return (await res.json()) as TranscriptionResult;
}

export async function synthesize(opts: { text: string; voice: string; format: string }): Promise<Blob> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw await erroDaResposta(res);
  return res.blob();
}

// ---------------------------------------------------------------- compressão

/**
 * Argumentos do ffmpeg para levar um áudio ao formato de envio.
 *
 * Opus mono a 16 kHz, no modo `voip`, que o codificador otimiza para fala. Não
 * é economia que custa precisão: o Whisper converte toda entrada para 16 kHz
 * mono antes de transcrever, então nada além disso chega a ser usado. A 16
 * kbps, os 4 MB do limite cobrem cerca de 35 minutos de fala.
 */
export function argsDeCompressao(entrada: string, saida: string, kbps: number): string[] {
  return [
    "-i", entrada,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "libopus",
    "-b:a", `${kbps}k`,
    "-application", "voip",
    saida,
  ];
}

/**
 * Deixa o áudio dentro do limite de envio, comprimindo no navegador se preciso.
 *
 * Abaixo do limite, o arquivo vai como está. Acima, tenta 16 kbps; se ainda
 * passar — áudios de mais de meia hora —, tenta 8 kbps, que segue inteligível
 * para fala e cobre pouco mais de uma hora. Se nem assim couber, explica.
 */
export async function prepararAudioParaEnvio(arquivo: File, onStatus?: (msg: string) => void): Promise<File> {
  if (arquivo.size <= LIMITE_DE_ENVIO) return arquivo;

  const { runFFmpeg } = await import("./ffmpeg-runner");
  const extensao = arquivo.name.split(".").pop() || "audio";
  const entrada = `entrada.${extensao}`;
  const nomeFinal = `${arquivo.name.replace(/\.[^.]+$/, "") || "audio"}.ogg`;

  for (const kbps of [16, 8]) {
    onStatus?.(`Comprimindo o áudio no seu navegador (${kbps} kbps)...`);
    const blob = await runFFmpeg({
      inputs: [{ name: entrada, data: arquivo }],
      args: argsDeCompressao(entrada, "envio.ogg", kbps),
      output: "envio.ogg",
    });
    if (blob.size <= LIMITE_DE_ENVIO) return new File([blob], nomeFinal, { type: "audio/ogg" });
  }

  throw new Error("Este áudio é longo demais para enviar de uma vez (limite de pouco mais de uma hora de fala). Divida o arquivo e tente de novo.");
}
