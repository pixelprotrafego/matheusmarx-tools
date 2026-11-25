import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { runFFmpeg } from "@/lib/ffmpeg-runner";
import { GIF_PALETTE, gifSteps } from "@/lib/media-presets";
import { downloadBlob, replaceExt } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { FileVideo } from "lucide-react";

const VideoToGif = () => {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState("0");
  const [duration, setDuration] = useState("5");
  const [fps, setFps] = useState(15);
  const [width, setWidth] = useState(480);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const seconds = (v: string) => Number(v.trim().replace(",", "."));
    const from = seconds(start);
    const length = seconds(duration);
    if (!Number.isFinite(from) || from < 0 || !Number.isFinite(length) || length <= 0) {
      toast.error("Informe o início e a duração em segundos (por exemplo, 0 e 5).");
      return;
    }
    // O GIF marca o tempo em centésimos: acima de 50 quadros por segundo os
    // navegadores tocam mais devagar.
    if (!(fps >= 1 && fps <= 50) || !(width >= 16 && width <= 1920)) {
      toast.error("Use de 1 a 50 quadros por segundo e largura de 16 a 1920 px.");
      return;
    }
    const rl = guard("video-gif", { hourly: 10, daily: 30 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      const blob = await runFFmpeg({
        inputs: [{ name: "in.mp4", data: file }],
        args: gifSteps("in.mp4", "out.gif", `fps=${Math.round(fps)},scale=${Math.round(width)}:-1:flags=lanczos`,
          ["-ss", String(from), "-t", String(length)]),
        output: "out.gif",
        temps: [GIF_PALETTE],
        onProgress: setProgress,
        onStatus: setStatus,
      });
      downloadBlob(new Blob([await blob.arrayBuffer()], { type: "image/gif" }), replaceExt(file.name, "gif"));
      toast.success("GIF gerado!");
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="video/*" title="Arraste vídeo" /> :
        <FileBadge file={file} icon={<FileVideo className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {file && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><Label className="text-xs">Início (s)</Label><Input value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Duração (s)</Label><Input value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">FPS</Label><Input type="number" value={fps} onChange={(e) => setFps(+e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Largura (px)</Label><Input type="number" value={width} onChange={(e) => setWidth(+e.target.value)} /></div>
        </div>
      )}
      {loading && <ProgressState progress={progress} status={status} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {file && !loading && !error && <ConvertButton onClick={go} label="Gerar GIF" />}
    </div>
  );
};

export default VideoToGif;