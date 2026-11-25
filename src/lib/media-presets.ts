import type { MediaInfo, MediaStream } from "./ffmpeg-runner";

export type MediaKind = "video" | "audio";

export interface FormatOption {
  value: string;
  label: string;
  accept: string;
  icon: MediaKind;
}

export const MEDIA_INPUT_FORMATS: FormatOption[] = [
  { value: "mp4", label: "MP4", accept: "video/mp4,.mp4", icon: "video" },
  { value: "mkv", label: "MKV", accept: "video/x-matroska,.mkv", icon: "video" },
  { value: "avi", label: "AVI", accept: "video/x-msvideo,.avi", icon: "video" },
  { value: "webm", label: "WebM", accept: "video/webm,.webm", icon: "video" },
  { value: "mov", label: "MOV", accept: "video/quicktime,.mov", icon: "video" },
  { value: "m4v", label: "M4V", accept: "video/x-m4v,.m4v", icon: "video" },
  { value: "ts", label: "TS", accept: ".ts,video/mp2t", icon: "video" },
  { value: "wmv", label: "WMV", accept: ".wmv,video/x-ms-wmv", icon: "video" },
  { value: "flv", label: "FLV", accept: ".flv,video/x-flv", icon: "video" },
  { value: "3gp", label: "3GP", accept: ".3gp,video/3gpp", icon: "video" },
  { value: "wav", label: "WAV", accept: "audio/wav,.wav", icon: "audio" },
  { value: "mp3", label: "MP3", accept: "audio/mpeg,.mp3", icon: "audio" },
  { value: "flac", label: "FLAC", accept: "audio/flac,.flac", icon: "audio" },
  { value: "ogg", label: "OGG", accept: "audio/ogg,.ogg", icon: "audio" },
  { value: "m4a", label: "M4A", accept: "audio/mp4,.m4a", icon: "audio" },
  { value: "aac", label: "AAC", accept: "audio/aac,.aac", icon: "audio" },
  { value: "opus", label: "OPUS", accept: "audio/opus,.opus", icon: "audio" },
  { value: "aiff", label: "AIFF", accept: "audio/aiff,.aiff,.aif", icon: "audio" },
  { value: "wma", label: "WMA", accept: ".wma,audio/x-ms-wma", icon: "audio" },
];

const VIDEO_EXTS = ["mp4", "mkv", "avi", "webm", "mov", "m4v", "ts", "wmv", "flv", "3gp"];
const AUDIO_EXTS = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "aiff", "wma"];
const VIDEO_OUT = ["mp4", "mkv", "webm", "mov", "gif"];
const AUDIO_OUT = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"];

export function getOutputs(inputExt: string): string[] {
  if (VIDEO_EXTS.includes(inputExt)) {
    return [...VIDEO_OUT.filter((x) => x !== inputExt), ...AUDIO_OUT];
  }
  if (AUDIO_EXTS.includes(inputExt)) {
    return AUDIO_OUT.filter((x) => x !== inputExt);
  }
  return [];
}

export function isVideo(ext: string) {
  return VIDEO_EXTS.includes(ext);
}
export function isAudio(ext: string) {
  return AUDIO_EXTS.includes(ext);
}

export function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4", mkv: "video/x-matroska", mp3: "audio/mpeg",
    wav: "audio/wav", avi: "video/x-msvideo", webm: "video/webm",
    mov: "video/quicktime", flac: "audio/flac", ogg: "audio/ogg",
    m4v: "video/x-m4v", ts: "video/mp2t", wmv: "video/x-ms-wmv",
    flv: "video/x-flv", "3gp": "video/3gpp", m4a: "audio/mp4",
    aac: "audio/aac", opus: "audio/opus", aiff: "audio/aiff",
    wma: "audio/x-ms-wma", gif: "image/gif",
  };
  return map[ext] || "application/octet-stream";
}

export interface ConvertOpts {
  audioBitrate?: number; // kbps
}

/** Lados pares: o H.264 em 4:2:0 recusa largura ou altura ímpar. */
export const EVEN_SIZE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

/**
 * H.264 que todo player toca: 4:2:0 em 8 bits. Sem o `-pix_fmt`, uma origem
 * 4:4:4 ou de 10 bits virava um H.264 "High 4:4:4", que navegador e celular
 * não abrem.
 */
export function h264Args(crf: number, preset = "fast"): string[] {
  return ["-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p"];
}

/** Índice do MP4/MOV no começo: o vídeo começa a tocar antes de baixar inteiro. */
export function faststart(ext: string): string[] {
  return ext === "mp4" || ext === "mov" || ext === "m4v" ? ["-movflags", "+faststart"] : [];
}

export const GIF_PALETTE = "paleta.png";

/**
 * GIF em duas passadas: a primeira escolhe as 256 cores a partir do próprio
 * vídeo, a segunda pinta com elas, com pontilhado. Numa passada só o ffmpeg usa
 * uma paleta genérica (cores manchadas, faixas nos degradês); e o atalho de
 * uma passada com `split` guarda o vídeo inteiro na memória até a paleta ficar
 * pronta, o que estoura o navegador num vídeo de um minuto.
 */
export function gifSteps(input: string, output: string, filters: string, before: string[] = []): string[][] {
  return [
    [...before, "-i", input, "-vf", `${filters},palettegen`, "-y", GIF_PALETTE],
    [...before, "-i", input, "-i", GIF_PALETTE, "-lavfi", `${filters}[x];[x][1:v]paletteuse`, "-y", output],
  ];
}

const LOSSLESS_CODECS = /^(flac|alac|wavpack|ape|tta|truehd|mlp|pcm_)/;
/** Contêineres de áudio que guardam capa de álbum, e as capas que aceitam. */
const COVER_ART = new Set(["mp3", "m4a", "flac"]);
const COVER_CODECS = new Set(["mjpeg", "png"]);
/** Legendas de texto (as demais são imagem: PGS, DVD, DVB). */
const TEXT_SUBS = new Set(["subrip", "srt", "ass", "ssa", "mov_text", "webvtt", "text"]);

/** O que cada contêiner de saída aceita sem recodificar o vídeo. */
const COPY_VIDEO: Record<string, (v: MediaStream) => boolean> = {
  // H.264 só em 4:2:0 de 8 bits (o resto não toca no navegador); HEVC como o
  // celular grava, inclusive o HDR de 10 bits.
  mp4: (v) =>
    (v.codec === "h264" && /^yuvj?420p$/.test(v.format ?? "")) ||
    (v.codec === "hevc" && /^yuv420p(10le)?$/.test(v.format ?? "")),
  webm: (v) => v.codec === "vp8" || v.codec === "vp9" || v.codec === "av1",
  mkv: (v) => ["h264", "hevc", "vp8", "vp9", "av1", "mpeg4", "mpeg2video"].includes(v.codec),
};
COPY_VIDEO.mov = COPY_VIDEO.mp4;

const MP4_AUDIO = new Set(["aac", "mp3", "ac3", "eac3", "alac"]);
const COPY_AUDIO: Record<string, Set<string>> = {
  mp4: MP4_AUDIO,
  mov: MP4_AUDIO,
  webm: new Set(["opus", "vorbis"]),
  mkv: new Set(["aac", "mp3", "ac3", "eac3", "dts", "opus", "vorbis", "flac", "truehd", "alac"]),
};

function subtitleArgs(subs: MediaStream[], outputExt: string): string[] {
  const out: string[] = [];
  let k = 0;
  for (const s of subs) {
    const text = TEXT_SUBS.has(s.codec);
    let codec: string | null;
    if (outputExt === "mkv") codec = text && (s.codec === "mov_text" || s.codec === "text") ? "srt" : "copy";
    else if (outputExt === "webm") codec = text ? "webvtt" : null;
    else codec = text ? "mov_text" : null; // MP4/MOV não guardam legenda em imagem
    if (!codec) continue;
    out.push("-map", `0:${s.index}`, `-c:s:${k++}`, codec);
  }
  return out;
}

/** O vídeo principal (capa de álbum não conta). */
function mainVideo(info: MediaInfo | null): MediaStream | undefined {
  return info?.streams.find((s) => s.kind === "video" && !s.attachedPic);
}

/**
 * Fluxos que vão para um vídeo de saída: o vídeo principal, todas as faixas de
 * áudio (idiomas, comentários) e as legendas que o destino guarda, já com o
 * codec de cada legenda. Dados (como a trilha de metadados do iPhone) ficam de
 * fora: o MP4 recusava alguns e a conversão falhava. Sem o vídeo, `[]`, e o
 * ffmpeg escolhe sozinho.
 */
export function mapStreams(info: MediaInfo | null, outputExt: string): string[] {
  const video = mainVideo(info);
  if (!info || !video) return ["-sn", "-dn"];
  return [
    "-map", `0:${video.index}`,
    ...info.streams.filter((s) => s.kind === "audio").flatMap((a) => ["-map", `0:${a.index}`]),
    ...subtitleArgs(info.streams.filter((s) => s.kind === "subtitle"), outputExt),
  ];
}

/** Vídeo para vídeo: copia o que o destino aceita como está, recodifica o resto. */
function videoArgs(input: string, output: string, outputExt: string, bitrate: string, info: MediaInfo | null): string[] {
  const video = mainVideo(info);
  // Vorbis no WebM: o libopus deste ffmpeg.wasm quebra o motor com áudio
  // estéreo (só codifica mono), e o WebM antigo falhava por isso também.
  const audioCodec = outputExt === "webm" ? "libvorbis" : "aac";
  const args = ["-i", input, ...mapStreams(info, outputExt)];
  if (video && COPY_VIDEO[outputExt]?.(video)) {
    // Mudar só o contêiner é instantâneo e não perde nada.
    args.push("-c:v", "copy");
    // O "hvc1" é o que o QuickTime e o iPhone exigem para tocar HEVC em MP4.
    if (video.codec === "hevc" && outputExt !== "mkv") args.push("-tag:v", "hvc1");
  } else if (outputExt === "webm") {
    // VP8, e não VP9: o codificador VP9 deste ffmpeg.wasm (core 0.12.9) quebra
    // o motor por volta do 25º quadro, com qualquer parâmetro — a saída WebM
    // falhava em todo vídeo com mais de um segundo. Qualidade constante (CRF),
    // com um teto de taxa proporcional ao tamanho do vídeo (antes era 1 Mbps
    // fixo, que borrava o 1080p).
    const pixels = (video?.width ?? 1280) * (video?.height ?? 720) * Math.min(video?.fps ?? 30, 60);
    const cap = Math.round(Math.min(16e6, Math.max(1e6, pixels * 0.15)) / 1000);
    args.push("-c:v", "libvpx", "-crf", "8", "-b:v", `${cap}k`, "-deadline", "good", "-cpu-used", "4");
  } else {
    args.push(...h264Args(18), "-vf", EVEN_SIZE); // CRF 18: visualmente sem perda
  }
  const audios = info?.streams.filter((s) => s.kind === "audio") ?? [];
  if (video && audios.length) {
    // Cada faixa copiada quando o destino a aceita.
    audios.forEach((a, k) => {
      if (COPY_AUDIO[outputExt]?.has(a.codec)) args.push(`-c:a:${k}`, "copy");
      else args.push(`-c:a:${k}`, audioCodec, `-b:a:${k}`, bitrate);
    });
  } else {
    args.push("-c:a", audioCodec, "-b:a", bitrate);
  }
  args.push(...faststart(outputExt), output);
  return args;
}

/** Taxas NTSC escritas como o ffmpeg as mostra ("29.97"), na forma exata. */
const NTSC: Record<string, string> = { "23.98": "24000/1001", "29.97": "30000/1001", "59.94": "60000/1001" };

/**
 * Vídeos que se juntam sem recodificar: mesmo codec, tamanho, formato e taxa
 * de quadros, e áudio igual. Fora disso, colar os bytes "funciona" (o ffmpeg
 * sai sem erro), mas o arquivo trava ou perde a imagem a partir do segundo.
 */
export function canJoinByCopy(infos: MediaInfo[]): boolean {
  const key = (info: MediaInfo) => {
    const v = mainVideo(info);
    const a = info.streams.find((s) => s.kind === "audio");
    if (!v) return null;
    return JSON.stringify([v.codec, v.width, v.height, v.format, v.fps, a?.codec, a?.sampleRate, a?.layout]);
  };
  const first = key(infos[0]);
  return first !== null && infos.every((i) => key(i) === first);
}

/**
 * Junta vídeos recodificando: todos vão para o tamanho e a taxa de quadros do
 * primeiro (antes, tudo caía para 1280x720 a 30 quadros), com barras pretas
 * quando a proporção difere. Vídeo sem som ganha silêncio do tamanho dele, em
 * vez de fazer a junção falhar.
 */
export function joinArgs(inputs: { name: string; info: MediaInfo }[], output: string): string[] {
  const first = mainVideo(inputs[0].info);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const W = first?.width ? even(first.width) : 1280;
  const H = first?.height ? even(first.height) : 720;
  const rate = first?.fps && first.fps <= 60 ? (NTSC[first.fps.toFixed(2)] ?? String(first.fps)) : "30";
  const withAudio = inputs.some((i) => i.info.streams.some((s) => s.kind === "audio"));
  const graph: string[] = [];
  const pads: string[] = [];
  inputs.forEach(({ info }, i) => {
    const v = mainVideo(info);
    const a = info.streams.find((s) => s.kind === "audio");
    graph.push(
      `[${i}:${v ? v.index : "v:0"}]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${rate},format=yuv420p[v${i}]`,
    );
    if (withAudio) {
      graph.push(a
        ? `[${i}:${a.index}]aresample=48000:async=1:first_pts=0[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${(info.duration ?? 0.04).toFixed(3)}[a${i}]`);
    }
    pads.push(withAudio ? `[v${i}][a${i}]` : `[v${i}]`);
  });
  graph.push(`${pads.join("")}concat=n=${inputs.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? "[a]" : ""}`);
  return [
    ...inputs.flatMap((i) => ["-i", i.name]),
    "-filter_complex", graph.join(";"),
    "-map", "[v]",
    ...(withAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
    ...h264Args(18, "veryfast"),
    ...faststart("mp4"),
    output,
  ];
}

/**
 * Argumentos do ffmpeg para converter `input.<ext>` em `output.<ext>`, em uma
 * ou mais passadas. `info` é a descrição da entrada (ver `probeMedia`); sem
 * ela, valem escolhas que servem a qualquer arquivo, sem cópia direta.
 */
export function getFFmpegArgs(
  inputExt: string,
  outputExt: string,
  opts: ConvertOpts = {},
  info: MediaInfo | null = null
): string[][] {
  const input = `input.${inputExt}`;
  const output = `output.${outputExt}`;
  const bitrate = `${opts.audioBitrate ?? 192}k`;

  // Vídeo -> GIF: 15 quadros por segundo, até 480 px de largura (sem ampliar).
  if (outputExt === "gif") {
    return gifSteps(input, output, "fps=15,scale='min(480,iw)':-1:flags=lanczos");
  }

  if (isVideo(outputExt)) return [videoArgs(input, output, outputExt, bitrate, info)];

  // Saída de áudio: a primeira faixa de áudio e, entre formatos que guardam
  // capa, a capa do álbum. Legenda, dados e vídeo ficam de fora: antes o
  // ffmpeg tentava gravar a capa do MP3 como vídeo no OGG, e o motor quebrava.
  const audio = info?.streams.find((s) => s.kind === "audio");
  if (info && info.streams.length && !audio) throw new Error("Este arquivo não tem faixa de áudio.");
  const cover = !isVideo(inputExt) && COVER_ART.has(outputExt)
    ? info?.streams.find((s) => s.attachedPic && COVER_CODECS.has(s.codec))
    : undefined;
  return [[
    "-i", input,
    "-map", audio ? `0:${audio.index}` : "0:a:0",
    ...(cover ? ["-map", `0:${cover.index}`, "-c:v", "copy", "-disposition:v:0", "attached_pic"] : []),
    ...audioCodecArgs(outputExt, bitrate, audio),
    output,
  ]];
}

function audioCodecArgs(ext: string, bitrate: string, source: MediaStream | undefined): string[] {
  switch (ext) {
    case "mp3": return ["-c:a", "libmp3lame", "-b:a", bitrate];
    case "wav": return ["-c:a", wavCodec(source)];
    case "flac": return ["-c:a", "flac"];
    case "ogg": return ["-c:a", "libvorbis", "-b:a", bitrate];
    case "m4a": case "aac": return ["-c:a", "aac", "-b:a", bitrate];
    // O libopus deste ffmpeg.wasm só codifica mono (com estéreo, o motor
    // quebra). Fora do mono, vai o codificador Opus próprio do ffmpeg, que
    // aceita até dois canais: surround desce para estéreo.
    case "opus":
      if (source?.layout === "mono") return ["-c:a", "libopus", "-b:a", bitrate];
      return ["-c:a", "opus", "-strict", "-2", ...(source?.layout === "stereo" ? [] : ["-ac", "2"]), "-b:a", bitrate];
    default: return [];
  }
}

/**
 * PCM do WAV com a resolução da origem: os 24 bits de um FLAC de estúdio
 * continuam 24 (antes viravam 16). Origem com perda (MP3, AAC...) vai a 16
 * bits, que já cobrem tudo o que ela tem.
 */
export function wavCodec(source: MediaStream | undefined): string {
  if (!source || !LOSSLESS_CODECS.test(source.codec)) return "pcm_s16le";
  if (/^pcm_f/.test(source.codec)) return "pcm_f32le";
  const bits = source.bits ?? (/^s32/.test(source.format ?? "") ? 32 : 16);
  return bits > 24 ? "pcm_s32le" : bits > 16 ? "pcm_s24le" : "pcm_s16le";
}
