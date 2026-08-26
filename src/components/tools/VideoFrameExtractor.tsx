import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { getFFmpeg, resetFFmpeg } from "@/lib/ffmpeg";
import { downloadAsZip } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { FileVideo } from "lucide-react";

const VideoFrameExtractor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState(1);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const rl = guard("video-frames", { hourly: 8, daily: 25 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      setStatus("Inicializando...");
      const ffmpeg = await getFFmpeg(setProgress);
      const { fetchFile } = await import("@ffmpeg/util");
      await ffmpeg.writeFile("in.mp4", await fetchFile(file));
      setStatus("Extraindo frames...");
      const code = await ffmpeg.exec(["-i", "in.mp4", "-vf", `fps=${fps}`, "frame-%04d.png"]);
      if (code !== 0) throw new Error(`FFmpeg código ${code}`);
      const list = await ffmpeg.listDir("/");
      const frames = list.filter((f: any) => f.name.startsWith("frame-") && f.name.endsWith(".png"));
      const out: { name: string; blob: Blob }[] = [];
      for (const f of frames) {
        const data = await ffmpeg.readFile(f.name);
        const buf = (data as Uint8Array).slice().buffer;
        out.push({ name: f.name, blob: new Blob([buf], { type: "image/png" }) });
        try { await ffmpeg.deleteFile(f.name); } catch {}
      }
      try { await ffmpeg.deleteFile("in.mp4"); } catch {}
      if (!out.length) throw new Error("Nenhum frame extraído");
      await downloadAsZip(out, `${file.name.replace(/\.[^.]+$/, "")}-frames.zip`);
      toast.success(`${out.length} frames extraídos`);
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
      resetFFmpeg();
    } finally { setLoading(false); setStatus(""); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="video/*" title="Arraste vídeo" /> :
        <FileBadge file={file} icon={<FileVideo className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {file && (
        <div className="space-y-2 max-w-xs">
          <Label>Frames por segundo</Label>
          <Input type="number" value={fps} step="0.5" min="0.1" onChange={(e) => setFps(+e.target.value)} />
        </div>
      )}
      {loading && <ProgressState progress={progress} status={status} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {file && !loading && !error && <ConvertButton onClick={go} label="Extrair frames (ZIP)" />}
    </div>
  );
};

export default VideoFrameExtractor;