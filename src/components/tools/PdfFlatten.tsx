import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { FileText } from "lucide-react";

const PdfFlatten = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      try { pdf.getForm().flatten(); } catch { /* PDF sem formulário: nada a achatar */ }
      const bytes = await pdf.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"),
        replaceExt(file.name, "pdf").replace(/\.pdf$/, ".flattened.pdf"));
      toast.success("Formulário achatado!");
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {error && <ErrorState message={error} onRetry={go} />}
      {file && !error && <ConvertButton onClick={go} loading={loading} label="Achatar formulário" />}
    </div>
  );
};

export default PdfFlatten;