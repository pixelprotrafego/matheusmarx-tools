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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { keepOpenPassword, loadPdfLib, openPdf } from "@/lib/pdf-unlock";
import { parsePageSelection } from "@/lib/page-range";
import { FileText } from "lucide-react";

const PdfRotator = () => {
  const [file, setFile] = useState<File | null>(null);
  const [angle, setAngle] = useState<"90" | "180" | "270">("90");
  const [range, setRange] = useState("all");
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
      const { degrees } = await loadPdfLib();
      const opened = await openPdf(await file.arrayBuffer(), password);
      const pages = opened.doc.getPages();
      for (const i of parsePageSelection(range, pages.length)) {
        const p = pages[i];
        p.setRotation(degrees((p.getRotation().angle + Number(angle)) % 360));
      }
      keepOpenPassword(opened);
      const bytes = await opened.doc.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"), replaceExt(file.name, "pdf"));
      toast.success("PDF rotacionado!");
      chooseFile(null);
    } catch (e) {
      if (!pdfPassword.catchPassword(e)) setError(e instanceof Error ? e.message : "Erro");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => chooseFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => chooseFile(null)} />}
      {file && (
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Ângulo</Label>
            <Select value={angle} onValueChange={(v) => setAngle(v as typeof angle)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="90">90° horário</SelectItem>
                <SelectItem value="180">180°</SelectItem>
                <SelectItem value="270">90° anti-horário (270°)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Páginas (ex: 1-3,5 ou "all")</Label>
            <Input value={range} onChange={(e) => setRange(e.target.value)} placeholder="all" />
          </div>
        </div>
      )}
      {pdfPassword.request && (
        <PdfPasswordPrompt
          reason={pdfPassword.request}
          busy={loading}
          onSubmit={(pw) => { pdfPassword.provide(pw); void go(pw); }}
        />
      )}
      {error && <ErrorState message={error} onRetry={() => go()} />}
      {file && !error && !pdfPassword.request && <ConvertButton onClick={() => go()} loading={loading} label="Rotacionar PDF" />}
    </div>
  );
};

export default PdfRotator;
