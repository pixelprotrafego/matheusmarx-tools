import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { downloadBlob, replaceExt } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { Sparkles } from "lucide-react";

const BackgroundRemover = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const rl = guard("bg-remove", { hourly: 10, daily: 30 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : {
        description: `Tente novamente em ${formatReset(rl.resetInMs)}.`,
      });
      return;
    }
    setLoading(true); setError(null); setResultUrl(null); setProgress(0);
    try {
      setStatus("Carregando modelo (pode demorar na 1ª vez, ~30 MB)...");
      const { removeBackground } = await import("@imgly/background-removal");
      const blob = await removeBackground(file, {
        progress: (key, current, total) => {
          setStatus(`${key}: ${current}/${total}`);
          setProgress(Math.round((current / total) * 100));
        },
      });
      const url = URL.createObjectURL(blob);
      setResultUrl(url);
      downloadBlob(blob, replaceExt(file.name, "png"));
      toast.success("Fundo removido!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao remover fundo");
    } finally { setLoading(false); setStatus(""); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="image/*" title="Arraste sua imagem" hint="O modelo é executado no seu navegador" /> :
        <FileBadge file={file} icon={<Sparkles className="w-4 h-4 text-primary" />} onRemove={() => { setFile(null); setResultUrl(null); }} />}
      {loading && <ProgressState progress={progress} status={status} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {file && !loading && !error && !resultUrl && <ConvertButton onClick={go} label="Remover fundo" loadingLabel="Processando..." />}
      {resultUrl && (
        <div className="rounded-lg border border-border p-4 bg-secondary/30 text-center">
          <img src={resultUrl} alt="Resultado" className="max-h-[400px] mx-auto" />
        </div>
      )}
    </div>
  );
};

export default BackgroundRemover;