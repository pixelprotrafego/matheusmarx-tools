import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { downloadBlob, replaceExt } from "@/lib/download";
import { FileText } from "lucide-react";
import { useAdoptDroppedFile } from "./shared/dropped-file";
import { convertText, type TextFmt } from "@/lib/text-convert";

// O motor vive em @/lib/text-convert para poder ser testado sozinho.
export type { TextFmt };

interface Props {
  inputFmt: TextFmt;
  outputFmt: TextFmt;
  inputAccept: string;
}

const MIME: Record<TextFmt, string> = {
  txt: "text/plain", md: "text/markdown", html: "text/html",
  csv: "text/csv", json: "application/json", yaml: "application/x-yaml",
};

const UniversalTextConverter = ({ inputFmt, outputFmt, inputAccept }: Props) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useAdoptDroppedFile(setFile);

  const convert = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const text = await file.text();
      const out = await convertText(text, inputFmt, outputFmt);
      const blob = new Blob([out], { type: MIME[outputFmt] });
      downloadBlob(blob, replaceExt(file.name, outputFmt));
      toast.success("Conversão concluída!");
      setFile(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro";
      setError(msg);
      toast.error("Falha", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <Dropzone onFiles={(fs) => setFile(fs[0])} accept={inputAccept} title={`Arraste arquivo .${inputFmt}`} hint={`Saída: .${outputFmt}`} />
      ) : (
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />
      )}
      {loading && <ProgressState status="Convertendo..." />}
      {error && !loading && <ErrorState message={error} onRetry={convert} />}
      {file && !loading && !error && <ConvertButton onClick={convert} label={`Converter para ${outputFmt.toUpperCase()}`} />}
    </div>
  );
};

export default UniversalTextConverter;
