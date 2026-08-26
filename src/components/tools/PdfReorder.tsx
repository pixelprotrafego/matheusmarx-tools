import { useState } from "react";
import { PDFDocument } from "pdf-lib";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { FileText } from "lucide-react";

const PdfReorder = () => {
  const [file, setFile] = useState<File | null>(null);
  const [order, setOrder] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (f: File) => {
    setFile(f);
    const pdf = await PDFDocument.load(await f.arrayBuffer());
    setPageCount(pdf.getPageCount());
    setOrder(Array.from({ length: pdf.getPageCount() }, (_, i) => i + 1).join(","));
  };

  const go = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const src = await PDFDocument.load(await file.arrayBuffer());
      const out = await PDFDocument.create();
      const indices = order.split(",").map((s) => parseInt(s.trim(), 10) - 1).filter((i) => i >= 0 && i < src.getPageCount());
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"), replaceExt(file.name, "pdf"));
      toast.success("Páginas reordenadas!");
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => onFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => { setFile(null); setOrder(""); setPageCount(0); }} />}
      {file && (
        <div className="space-y-2">
          <Label>Nova ordem (separe por vírgulas — {pageCount} páginas)</Label>
          <Input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="3,1,2,4" />
          <p className="text-xs text-muted-foreground">Páginas omitidas serão removidas. Duplicar índices é permitido.</p>
        </div>
      )}
      {error && <ErrorState message={error} onRetry={go} />}
      {file && !error && <ConvertButton onClick={go} loading={loading} label="Reordenar PDF" />}
    </div>
  );
};

export default PdfReorder;