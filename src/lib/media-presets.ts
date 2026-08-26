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
  videoMode?: "reencode" | "copy";
}

export function getFFmpegArgs(
  inputExt: string,
  outputExt: string,
  opts: ConvertOpts = {}
): string[] {
  const input = `input.${inputExt}`;
  const output = `output.${outputExt}`;
  const inputIsVideo = isVideo(inputExt);
  const outputIsVideo = isVideo(outputExt) || outputExt === "gif";
  const bitrate = `${opts.audioBitrate ?? 192}k`;

  // Video -> GIF
  if (outputExt === "gif") {
    return ["-i", input, "-vf", "fps=15,scale=480:-1:flags=lanczos", output];
  }

  // Video -> Audio
  if (inputIsVideo && !outputIsVideo) {
    return ["-i", input, "-vn", ...audioCodecArgs(outputExt, bitrate), output];
  }

  // Video -> Video
  if (inputIsVideo && outputIsVideo) {
    if (opts.videoMode === "copy") return ["-i", input, "-c", "copy", output];
    if (outputExt === "webm") return ["-i", input, "-c:v", "libvpx-vp9", "-b:v", "1M", "-c:a", "libopus", output];
    return ["-i", input, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", bitrate, output];
  }

  // Audio -> Audio
  return ["-i", input, ...audioCodecArgs(outputExt, bitrate), output];
}

function audioCodecArgs(ext: string, bitrate: string): string[] {
  switch (ext) {
    case "mp3": return ["-acodec", "libmp3lame", "-b:a", bitrate];
    case "wav": return ["-acodec", "pcm_s16le"];
    case "flac": return ["-acodec", "flac"];
    case "ogg": return ["-acodec", "libvorbis", "-b:a", bitrate];
    case "m4a": case "aac": return ["-acodec", "aac", "-b:a", bitrate];
    case "opus": return ["-acodec", "libopus", "-b:a", bitrate];
    default: return [];
  }
}