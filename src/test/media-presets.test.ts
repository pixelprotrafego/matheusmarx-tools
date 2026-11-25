import { describe, it, expect } from "vitest";
import { parseMediaInfo, type MediaInfo } from "@/lib/ffmpeg-runner";
import { canJoinByCopy, getFFmpegArgs, joinArgs, mapStreams, wavCodec } from "@/lib/media-presets";

// Linhas como o ffmpeg.wasm do site imprime (copiadas de execuções reais).
const MP4 = [
  "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
  "  Duration: 00:00:03.00, start: 0.000000, bitrate: 7550 kb/s",
  "  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], 7410 kb/s, 30 fps, 30 tbr, 15360 tbn (default)",
  "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s (default)",
];

describe("parseMediaInfo", () => {
  it("lê duração, codecs, tamanho, quadros e áudio", () => {
    const info = parseMediaInfo(MP4);
    expect(info.duration).toBe(3);
    expect(info.streams).toEqual([
      { index: 0, kind: "video", codec: "h264", format: "yuv420p", width: 1280, height: 720, fps: 30, attachedPic: false },
      { index: 1, kind: "audio", codec: "aac", format: "fltp", sampleRate: 48000, layout: "stereo" },
    ]);
  });

  it("não confunde a etiqueta 0x31637661 com o tamanho", () => {
    const [v] = parseMediaInfo(MP4).streams;
    expect([v.width, v.height]).toEqual([1280, 720]);
  });

  it("reconhece a capa do MP3 e os 24 bits do FLAC", () => {
    const capa = parseMediaInfo([
      "  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 64 kb/s",
      "  Stream #0:1: Video: png, rgb24(pc), 300x300 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)",
    ]);
    expect(capa.streams[1]).toMatchObject({ kind: "video", codec: "png", attachedPic: true });
    const flac = parseMediaInfo(["  Stream #0:0: Audio: flac, 96000 Hz, mono, s32 (24 bit)"]);
    expect(flac.streams[0]).toMatchObject({ codec: "flac", format: "s32", bits: 24 });
  });

  it("vídeo de celular gravado em pé (rotação de 90°) tem o tamanho exibido", () => {
    const info = parseMediaInfo([
      "  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080, 9000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)",
      "    Metadata:",
      "      handler_name    : Core Media Video",
      "    Side data:",
      "      displaymatrix: rotation of -90.00 degrees",
    ]);
    expect(info.streams[0]).toMatchObject({ codec: "hevc", format: "yuv420p10le", width: 1080, height: 1920, fps: 29.97 });
  });
});

const info = (lines: string[]): MediaInfo => parseMediaInfo(lines);
const flat = (steps: string[][]) => steps.map((s) => s.join(" ")).join(" && ");

describe("getFFmpegArgs", () => {
  it("só troca o contêiner quando o destino aceita os fluxos (sem recodificar)", () => {
    const args = flat(getFFmpegArgs("mp4", "mkv", {}, info(MP4)));
    expect(args).toContain("-c:v copy");
    expect(args).toContain("-c:a:0 copy");
    expect(args).not.toContain("libx264");
  });

  it("recodifica para H.264 4:2:0 de lados pares o que o MP4 não toca", () => {
    const mkv444 = info([
      "  Stream #0:0: Video: h264 (High 4:4:4 Predictive), yuv444p(tv, progressive), 641x361 [SAR 1:1 DAR 641:361], 30 fps, 30 tbr, 1k tbn",
      "  Stream #0:1: Audio: vorbis, 44100 Hz, mono, fltp",
    ]);
    const args = flat(getFFmpegArgs("mkv", "mp4", {}, mkv444));
    expect(args).toContain("-c:v libx264");
    expect(args).toContain("-pix_fmt yuv420p");
    expect(args).toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
    expect(args).toContain("-c:a:0 aac");
    expect(args).toContain("-movflags +faststart");
  });

  it("HEVC do iPhone vai para MP4 sem recodificar, com a etiqueta hvc1", () => {
    const hevc = info(["  Stream #0:0: Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv), 1920x1080, 29.97 fps", "  Stream #0:1: Audio: aac (LC), 44100 Hz, stereo, fltp"]);
    const args = flat(getFFmpegArgs("mov", "mp4", {}, hevc));
    expect(args).toContain("-c:v copy -tag:v hvc1");
  });

  it("WebM sai em VP8 com Vorbis (o VP9 e o libopus estéreo deste ffmpeg.wasm quebram o motor)", () => {
    const args = flat(getFFmpegArgs("mp4", "webm", {}, info(MP4)));
    expect(args).toContain("-c:v libvpx ");
    expect(args).not.toContain("vp9");
    expect(args).toContain("-c:a:0 libvorbis");
  });

  it("legenda de texto vira mov_text no MP4; legenda em imagem fica de fora", () => {
    const mkv = info([
      "  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1280x720, 30 fps",
      "  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp",
      "  Stream #0:2: Subtitle: subrip",
      "  Stream #0:3(por): Subtitle: hdmv_pgs_subtitle, 1920x1080",
    ]);
    const args = flat(getFFmpegArgs("mkv", "mp4", {}, mkv));
    expect(args).toContain("-map 0:2 -c:s:0 mov_text");
    expect(args).not.toContain("0:3");
    expect(flat(getFFmpegArgs("mkv", "mkv", {}, mkv))).toContain("-map 0:3 -c:s:1 copy");
  });

  it("áudio leva a capa só para quem a guarda", () => {
    const mp3 = info([
      "  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 64 kb/s",
      "  Stream #0:1: Video: png, rgb24(pc), 300x300, 90k tbr, 90k tbn (attached pic)",
    ]);
    expect(flat(getFFmpegArgs("mp3", "m4a", {}, mp3))).toContain("-map 0:1 -c:v copy -disposition:v:0 attached_pic");
    expect(flat(getFFmpegArgs("mp3", "ogg", {}, mp3))).not.toContain("0:1");
  });

  it("vídeo sem faixa de áudio para MP3 explica em vez de falhar", () => {
    const mudo = info(["  Stream #0:0: Video: h264 (High), yuv420p(progressive), 640x360, 25 fps"]);
    expect(() => getFFmpegArgs("mp4", "mp3", {}, mudo)).toThrow(/não tem faixa de áudio/);
  });

  it("GIF em duas passadas, com paleta própria", () => {
    const steps = getFFmpegArgs("mp4", "gif", {}, info(MP4));
    expect(steps).toHaveLength(2);
    expect(steps[0].join(" ")).toContain("palettegen");
    expect(steps[1].join(" ")).toContain("paletteuse");
  });
});

describe("wavCodec", () => {
  it("mantém a resolução de origem sem perda; com perda vai a 16 bits", () => {
    expect(wavCodec({ index: 0, kind: "audio", codec: "flac", format: "s32", bits: 24 })).toBe("pcm_s24le");
    expect(wavCodec({ index: 0, kind: "audio", codec: "flac", format: "s16" })).toBe("pcm_s16le");
    expect(wavCodec({ index: 0, kind: "audio", codec: "pcm_s32le", format: "s32" })).toBe("pcm_s32le");
    expect(wavCodec({ index: 0, kind: "audio", codec: "pcm_f32le", format: "flt" })).toBe("pcm_f32le");
    expect(wavCodec({ index: 0, kind: "audio", codec: "mp3", format: "fltp" })).toBe("pcm_s16le");
  });
});

describe("juntar vídeos", () => {
  const mudo = info(["  Duration: 00:00:02.00, start: 0.000000", "  Stream #0:0: Video: h264 (High), yuv420p(progressive), 640x360, 25 fps"]);
  it("cópia direta só entre vídeos iguais", () => {
    expect(canJoinByCopy([info(MP4), info(MP4)])).toBe(true);
    expect(canJoinByCopy([mudo, info(MP4)])).toBe(false);
  });

  it("segue tamanho e quadros do primeiro e põe silêncio no vídeo mudo", () => {
    const args = joinArgs([{ name: "a.mp4", info: mudo }, { name: "b.mp4", info: info(MP4) }], "out.mp4").join(" ");
    expect(args).toContain("scale=640:360");
    expect(args).toContain("fps=25");
    expect(args).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=2.000[a0]");
    expect(args).toContain("concat=n=2:v=1:a=1");
  });

  it("taxa NTSC na forma exata", () => {
    const ntsc = info(["  Stream #0:0: Video: h264 (High), yuv420p(progressive), 1920x1080, 29.97 fps"]);
    expect(joinArgs([{ name: "a.mp4", info: ntsc }], "o.mp4").join(" ")).toContain("fps=30000/1001");
  });
});

describe("mapStreams", () => {
  it("sem descrição do arquivo, deixa o ffmpeg escolher, mas sem legenda e dados", () => {
    expect(mapStreams(null, "mp4")).toEqual(["-sn", "-dn"]);
  });
});

describe("saída OPUS", () => {
  const audio = (layout: string) => info([`  Stream #0:0: Audio: aac (LC), 48000 Hz, ${layout}, fltp, 128 kb/s`]);
  it("mono vai pelo libopus; estéreo pelo Opus do ffmpeg; surround desce para estéreo", () => {
    expect(flat(getFFmpegArgs("m4a", "opus", {}, audio("mono")))).toContain("-c:a libopus");
    const estereo = flat(getFFmpegArgs("m4a", "opus", {}, audio("stereo")));
    expect(estereo).toContain("-c:a opus -strict -2");
    expect(estereo).not.toContain("-ac 2");
    expect(flat(getFFmpegArgs("m4a", "opus", {}, audio("5.1")))).toContain("-ac 2");
  });
});

describe("parseMediaInfo com a saída nula da sondagem", () => {
  it("lê só a entrada: os fluxos da saída vêm depois e não contam", () => {
    const lines = [
      ...MP4,
      "Stream mapping:",
      "  Stream #0:0 -> #0:0 (h264 (native) -> wrapped_avframe (native))",
      "Output #0, null, to 'pipe:':",
      "  Stream #0:0(und): Video: wrapped_avframe, yuv420p(progressive), 1280x720 [SAR 1:1 DAR 16:9], q=2-31, 200 kb/s, 30 fps, 30 tbn (default)",
      "  Stream #0:1(und): Audio: pcm_s16le, 48000 Hz, stereo, s16, 1536 kb/s (default)",
    ];
    expect(parseMediaInfo(lines).streams.map((s) => s.codec)).toEqual(["h264", "aac"]);
  });
});
