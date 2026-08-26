import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { runFFmpeg } from "@/lib/ffmpeg-runner";
import { downloadBlob, replaceExt } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { FileVideo } from "lucide-react";

const RES = { "1080p": 1080, "720p": 720, "480p": 480, "360p": 360 };

const VideoResizer = () => {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<keyof typeof RES>("720p");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const rl = guard("video-resize", { hourly: 8, daily: 25 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      const h = RES[res];
      const blob = await runFFmpeg({
        inputs: [{ name: "in.mp4", data: file }],
        args: ["-i", "in.mp4", "-vf", `scale=-2:${h}`, "-c:v", "libx264", "-crf", "23",
               "-preset", "fast", "-c:a", "aac", "-b:a", "128k", "out.mp4"],
        output: "out.mp4",
        onProgress: setProgress,
        onStatus: setStatus,
      });
      downloadBlob(new Blob([await blob.arrayBuffer()], { type: "video/mp4" }),
        replaceExt(file.name, "mp4").replace(/\.mp4$/, `.${res}.mp4`));
      toast.success(`Vídeo em ${res} pronto!`);
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="video/*" title="Arraste vídeo" /> :
        <FileBadge file={file} icon={<FileVideo className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {file && (
        <div className="space-y-2">
          <Label>Resolução de saída</Label>
          <Select value={res} onValueChange={(v: any) => setRes(v)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.keys(RES).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
      {loading && <ProgressState progress={progress} status={status} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {file && !loading && !error && <ConvertButton onClick={go} label="Redimensionar vídeo" />}
    </div>
  );
};

export default VideoResizer;