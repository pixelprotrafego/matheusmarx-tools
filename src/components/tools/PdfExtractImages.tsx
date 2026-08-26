import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { downloadAsZip } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { FileText } from "lucide-react";

const PdfExtractImages = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const rl = guard("pdf-extract-images", { hourly: 15, daily: 50 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      const { pdfjsLib } = await import("@/lib/pdfjs-setup");
      const data = new Uint8Array(await file.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const out: { name: string; blob: Blob }[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
        out.push({ name: `page-${String(p).padStart(3, "0")}.png`, blob });
        setProgress(Math.round((p / pdf.numPages) * 100));
      }
      await downloadAsZip(out, `${file.name.replace(/\.pdf$/i, "")}-pages.zip`);
      toast.success(`${out.length} páginas extraídas como PNG`);
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" hint="Cada página será exportada como PNG" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {loading && <ProgressState progress={progress} status="Renderizando páginas..." />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {file && !loading && !error && <ConvertButton onClick={go} label="Extrair páginas em PNG" />}
    </div>
  );
};

export default PdfExtractImages;