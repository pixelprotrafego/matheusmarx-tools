import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { getFFmpeg, resetFFmpeg, setProgressHandler, type ProgressCallback } from "./ffmpeg";

export type StreamKind = "video" | "audio" | "subtitle" | "data" | "attachment";

export interface MediaStream {
  /** Índice do fluxo no arquivo (o `N` de `-map 0:N`). */
  index: number;
  kind: StreamKind;
  codec: string;
  /** Tamanho exibido: já girado quando o vídeo tem rotação gravada. */
  width?: number;
  height?: number;
  fps?: number;
  /** Formato de pixel (vídeo) ou de amostra (áudio): yuv420p, s16, fltp... */
  format?: string;
  /** Bits por amostra do áudio, quando o ffmpeg informa ("s32 (24 bit)"). */
  bits?: number;
  /** Áudio: taxa de amostragem e canais ("stereo", "5.1"). */
  sampleRate?: number;
  layout?: string;
  /** Capa de álbum gravada como fluxo de vídeo. */
  attachedPic?: boolean;
}

export interface MediaInfo {
  /** Duração em segundos, se o arquivo informa. */
  duration: number | null;
  streams: MediaStream[];
}

const KINDS: Record<string, StreamKind> = {
  Video: "video", Audio: "audio", Subtitle: "subtitle", Data: "data", Attachment: "attachment",
};

/** Lê o que o ffmpeg imprime sobre a entrada (`ffmpeg -i arquivo`). */
export function parseMediaInfo(lines: string[]): MediaInfo {
  let duration: number | null = null;
  const streams: MediaStream[] = [];
  for (const line of lines) {
    // Só a entrada interessa: os fluxos da saída nula vêm depois e também
    // começam com "Stream #0:".
    if (/^\s*(Output #|Stream mapping:)/.test(line)) break;
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
    if (d) duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
    const s = /Stream #0:(\d+)[^:]*: (Video|Audio|Subtitle|Data|Attachment): ([^\s,]+)/.exec(line);
    if (s) {
      const stream: MediaStream = { index: +s[1], kind: KINDS[s[2]], codec: s[3] };
      // O codec nunca tem vírgula; o campo seguinte é o formato.
      const format = /: (?:Video|Audio): [^,]+, (?:\d+ Hz, [^,]+, )?([a-z0-9_]+)(?: \((\d+) bit\))?/.exec(line);
      if (format) {
        stream.format = format[1];
        if (format[2]) stream.bits = +format[2];
      }
      const audio = /, (\d+) Hz, ([^,]+),/.exec(line);
      if (stream.kind === "audio" && audio) {
        stream.sampleRate = +audio[1];
        stream.layout = audio[2];
      }
      if (stream.kind === "video") {
        // ", 1280x720" — a vírgula evita confundir com a tag "0x31637661".
        const size = /, (\d+)x(\d+)/.exec(line);
        if (size) {
          stream.width = +size[1];
          stream.height = +size[2];
        }
        const fps = /, (\d+(?:\.\d+)?) fps/.exec(line);
        if (fps) stream.fps = +fps[1];
        stream.attachedPic = /\(attached pic\)/.test(line);
      }
      streams.push(stream);
      continue;
    }
    // Rotação vem nas linhas de dados laterais logo abaixo do fluxo.
    const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(line);
    const last = streams[streams.length - 1];
    if (rot && last?.kind === "video" && last.width && last.height && Math.abs(Math.round(+rot[1] / 90)) % 2 === 1) {
      [last.width, last.height] = [last.height, last.width];
    }
  }
  return { duration, streams };
}

/** Descreve um arquivo que já está no sistema de arquivos do ffmpeg. */
export async function probeMedia(ffmpeg: FFmpeg, name: string): Promise<MediaInfo> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  ffmpeg.on("log", onLog);
  try {
    // Saída nula de duração zero: o ffmpeg descreve a entrada e termina
    // normalmente. O atalho `ffmpeg -i arquivo`, sem saída, termina num
    // abort() dentro do WebAssembly, e o motor fica instável para a conversão
    // seguinte.
    await ffmpeg.exec(["-hide_banner", "-i", name, "-t", "0", "-f", "null", "-"]);
  } finally {
    ffmpeg.off("log", onLog);
  }
  return parseMediaInfo(lines);
}

/** Um comando, ou vários em sequência (como as duas passadas do GIF). */
export type FFmpegArgs = string[] | string[][];

export interface FFmpegRun {
  inputs: { name: string; data: File | Blob }[];
  /** Os argumentos, ou uma função que os monta a partir da primeira entrada. */
  args: FFmpegArgs | ((info: MediaInfo) => FFmpegArgs);
  output: string;
  /** Arquivos intermediários a apagar no fim. */
  temps?: string[];
  onProgress?: ProgressCallback;
  onStatus?: (msg: string) => void;
}

export async function runFFmpeg({
  inputs,
  args,
  output,
  temps = [],
  onProgress,
  onStatus,
}: FFmpegRun): Promise<Blob> {
  onStatus?.("Inicializando motor de mídia...");
  const ffmpeg = await getFFmpeg();
  const { fetchFile } = await import("@ffmpeg/util");
  onStatus?.("Carregando arquivos...");
  for (const i of inputs) await ffmpeg.writeFile(i.name, await fetchFile(i.data));
  onStatus?.("Processando...");
  try {
    const built = typeof args === "function" ? args(await probeMedia(ffmpeg, inputs[0].name)) : args;
    const steps = Array.isArray(built[0]) ? (built as string[][]) : [built as string[]];
    for (let s = 0; s < steps.length; s++) {
      // Uma barra só de 0 a 100, dividida entre as passadas.
      setProgressHandler(onProgress && ((p) => onProgress(Math.round((s * 100 + p) / steps.length))));
      const code = await ffmpeg.exec(steps[s]);
      if (code !== 0) throw new Error(`FFmpeg código ${code}`);
    }
    const data = await ffmpeg.readFile(output);
    const buf = (data as Uint8Array).slice().buffer;
    const blob = new Blob([buf]);
    if (blob.size < 32) throw new Error("Arquivo gerado está vazio.");
    return blob;
  } catch (err) {
    resetFFmpeg();
    throw err;
  } finally {
    setProgressHandler(undefined);
    for (const name of [...inputs.map((i) => i.name), ...temps, output]) {
      try { await ffmpeg.deleteFile(name); } catch { /* já removido */ }
    }
  }
}
