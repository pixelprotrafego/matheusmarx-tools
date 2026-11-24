import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { keepOpenPassword, loadPdfLib, openPdf } from "@/lib/pdf-unlock";
import { parsePageOrder } from "@/lib/page-range";
import { FileText } from "lucide-react";

const PdfReorder = () => {
  const [file, setFile] = useState<File | null>(null);
  const [order, setOrder] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfPassword = usePdfPassword();

  const clear = () => {
    setFile(null); setOrder(""); setPageCount(0); setError(null);
    pdfPassword.reset();
  };

  /** Abre o arquivo só para saber quantas páginas ele tem. */
  const inspect = async (f: File, password?: string) => {
    setError(null);
    try {
      const { doc } = await openPdf(await f.arrayBuffer(), password, { updateMetadata: false });
      const total = doc.getPageCount();
      setPageCount(total);
      setOrder(Array.from({ length: total }, (_, i) => i + 1).join(","));
    } catch (e) {
      if (!pdfPassword.catchPassword(e)) setError(e instanceof Error ? e.message : "Erro ao abrir o PDF");
    }
  };

  const onFile = (f: File) => {
    clear();
    setFile(f);
    void inspect(f);
  };

  const go = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const { PDFDocument } = await loadPdfLib();
      const opened = await openPdf(await file.arrayBuffer(), pdfPassword.password);
      const indices = parsePageOrder(order, opened.doc.getPageCount());
      const out = await PDFDocument.create();
      const copied = await out.copyPages(opened.doc, indices);
      copied.forEach((p) => out.addPage(p));
      keepOpenPassword({ ...opened, doc: out });
      const bytes = await out.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"), replaceExt(file.name, "pdf"));
      toast.success("Páginas reordenadas!");
    } catch (e) {
      if (!pdfPassword.catchPassword(e)) setError(e instanceof Error ? e.message : "Erro");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => onFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={clear} />}
      {pdfPassword.request && file && (
        <PdfPasswordPrompt
          reason={pdfPassword.request}
          onSubmit={(pw) => { pdfPassword.provide(pw); void inspect(file, pw); }}
        />
      )}
      {file && pageCount > 0 && (
        <div className="space-y-2">
          <Label>Nova ordem (separe por vírgulas — {pageCount} páginas)</Label>
          <Input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="3,1,2,4" />
          <p className="text-xs text-muted-foreground">Páginas omitidas serão removidas. Duplicar índices é permitido.</p>
        </div>
      )}
      {error && <ErrorState message={error} onRetry={pageCount > 0 ? go : () => file && inspect(file, pdfPassword.password)} />}
      {file && pageCount > 0 && !error && <ConvertButton onClick={go} loading={loading} label="Reordenar PDF" />}
    </div>
  );
};

export default PdfReorder;
