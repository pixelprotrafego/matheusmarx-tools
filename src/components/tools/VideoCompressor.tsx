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

const PRESETS = {
  alta: { crf: 20, label: "Alta qualidade (CRF 20)" },
  media: { crf: 26, label: "Média (CRF 26)" },
  baixa: { crf: 32, label: "Baixa qualidade / leve (CRF 32)" },
};

const VideoCompressor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<keyof typeof PRESETS>("media");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const rl = guard("video-compress", { hourly: 8, daily: 25 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      const blob = await runFFmpeg({
        inputs: [{ name: "in.mp4", data: file }],
        args: ["-i", "in.mp4", "-c:v", "libx264", "-crf", String(PRESETS[preset].crf),
               "-preset", "medium", "-c:a", "aac", "-b:a", "128k", "out.mp4"],
        output: "out.mp4",
        onProgress: setProgress,
        onStatus: setStatus,
      });
      downloadBlob(new Blob([await blob.arrayBuffer()], { type: "video/mp4" }),
        replaceExt(file.name, "mp4").replace(/\.mp4$/, ".compressed.mp4"));
      toast.success("Vídeo comprimido!");
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
          <Label>Qualidade</Label>
          <Select value={preset} onValueChange={(v: any) => setPreset(v)}>
            <SelectTrigger className="w-full sm:w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(PRESETS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      {loading && <ProgressState progress={progress} status={status} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {file && !loading && !error && <ConvertButton onClick={go} label="Comprimir vídeo" />}
    </div>
  );
};

export default VideoCompressor;