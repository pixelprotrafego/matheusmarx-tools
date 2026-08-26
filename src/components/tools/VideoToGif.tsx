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
    const rl = guard("video-gif", { hourly: 10, daily: 30 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      const blob = await runFFmpeg({
        inputs: [{ name: "in.mp4", data: file }],
        args: ["-ss", start, "-t", duration, "-i", "in.mp4",
               "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos`,
               "out.gif"],
        output: "out.gif",
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