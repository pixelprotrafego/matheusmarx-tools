import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { keepOpenPassword, openPdf } from "@/lib/pdf-unlock";
import { FileText } from "lucide-react";

const PdfFlatten = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfPassword = usePdfPassword();

  const chooseFile = (f: File | null) => {
    setFile(f);
    setError(null);
    pdfPassword.reset();
  };

  const go = async (password = pdfPassword.password) => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const opened = await openPdf(await file.arrayBuffer(), password);
      try { opened.doc.getForm().flatten(); } catch { /* PDF sem formulário: nada a achatar */ }
      keepOpenPassword(opened);
      const bytes = await opened.doc.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"),
        replaceExt(file.name, "pdf").replace(/\.pdf$/, ".flattened.pdf"));
      toast.success("Formulário achatado!");
      chooseFile(null);
    } catch (e) {
      if (!pdfPassword.catchPassword(e)) setError(e instanceof Error ? e.message : "Erro");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => chooseFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => chooseFile(null)} />}
      {pdfPassword.request && (
        <PdfPasswordPrompt
          reason={pdfPassword.request}
          busy={loading}
          onSubmit={(pw) => { pdfPassword.provide(pw); void go(pw); }}
        />
      )}
      {error && <ErrorState message={error} onRetry={() => go()} />}
      {file && !error && !pdfPassword.request && <ConvertButton onClick={() => go()} loading={loading} label="Achatar formulário" />}
    </div>
  );
};

export default PdfFlatten;
