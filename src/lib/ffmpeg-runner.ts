import { getFFmpeg, resetFFmpeg, type ProgressCallback } from "./ffmpeg";

export interface FFmpegRun {
  inputs: { name: string; data: File | Blob }[];
  args: string[];
  output: string;
  onProgress?: ProgressCallback;
  onStatus?: (msg: string) => void;
}

export async function runFFmpeg({
  inputs,
  args,
  output,
  onProgress,
  onStatus,
}: FFmpegRun): Promise<Blob> {
  onStatus?.("Inicializando motor de mídia...");
  const ffmpeg = await getFFmpeg(onProgress);
  const { fetchFile } = await import("@ffmpeg/util");
  onStatus?.("Carregando arquivos...");
  for (const i of inputs) await ffmpeg.writeFile(i.name, await fetchFile(i.data));
  onStatus?.("Processando...");
  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`FFmpeg código ${code}`);
    const data = await ffmpeg.readFile(output);
    const buf = (data as Uint8Array).slice().buffer;
    const blob = new Blob([buf]);
    if (blob.size < 32) throw new Error("Arquivo gerado está vazio.");
    return blob;
  } catch (err) {
    resetFFmpeg();
    throw err;
  } finally {
    for (const i of inputs) {
      try { await ffmpeg.deleteFile(i.name); } catch { /* já removido */ }
    }
    try { await ffmpeg.deleteFile(output); } catch { /* já removido */ }
  }
}