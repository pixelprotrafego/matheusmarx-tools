import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { runFFmpeg } from "@/lib/ffmpeg-runner";
import { EVEN_SIZE, faststart, h264Args } from "@/lib/media-presets";
import { downloadBlob, replaceExt } from "@/lib/download";
import { FileVideo } from "lucide-react";
import { useAdoptDroppedFile } from "./shared/dropped-file";

const GifToMp4 = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useAdoptDroppedFile(setFile);

  const convert = async () => {
    if (!file) return;
    setLoading(true); setError(null); setProgress(0);
    try {
      const blob = await runFFmpeg({
        inputs: [{ name: "in.gif", data: file }],
        // O MP4 não tem transparência: o fundo transparente do GIF vira
        // branco, como numa página. Sem isso, aparecia a cor que o arquivo
        // guarda por baixo da transparência, que muda de um GIF para outro
        // (preto, magenta...), e não é a que a pessoa vê.
        args: ["-i", "in.gif",
               "-vf", `format=rgba,split[a][b];[a]drawbox=c=white:t=fill:replace=1[fundo];[fundo][b]overlay,${EVEN_SIZE}`,
               ...h264Args(18), ...faststart("mp4"), "out.mp4"],
        output: "out.mp4",
        onProgress: setProgress,
        onStatus: setStatus,
      });
      downloadBlob(new Blob([await blob.arrayBuffer()], { type: "video/mp4" }), replaceExt(file.name, "mp4"));
      toast.success("GIF convertido para MP4!");
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept=".gif,image/gif" title="Arraste seu GIF" /> :
        <FileBadge file={file} icon={<FileVideo className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {loading && <ProgressState progress={progress} status={status || "Convertendo..."} />}
      {error && !loading && <ErrorState message={error} onRetry={convert} />}
      {file && !loading && !error && <ConvertButton onClick={convert} label="Converter para MP4" />}
    </div>
  );
};

export default GifToMp4;