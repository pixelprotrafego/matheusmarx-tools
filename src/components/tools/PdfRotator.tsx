import { useState } from "react";
import { PDFDocument, degrees } from "pdf-lib";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { FileText } from "lucide-react";

const PdfRotator = () => {
  const [file, setFile] = useState<File | null>(null);
  const [angle, setAngle] = useState<"90" | "180" | "270">("90");
  const [range, setRange] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseRange = (s: string, total: number): number[] => {
    if (s === "all" || !s.trim()) return Array.from({ length: total }, (_, i) => i);
    const out = new Set<number>();
    for (const part of s.split(",")) {
      const [a, b] = part.trim().split("-").map(Number);
      const start = Math.max(1, a);
      const end = Math.min(total, b ?? a);
      for (let i = start; i <= end; i++) out.add(i - 1);
    }
    return [...out];
  };

  const go = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      const pages = pdf.getPages();
      const indices = parseRange(range, pages.length);
      for (const i of indices) {
        const p = pages[i];
        const current = p.getRotation().angle;
        p.setRotation(degrees((current + Number(angle)) % 360));
      }
      const bytes = await pdf.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"), replaceExt(file.name, "pdf"));
      toast.success("PDF rotacionado!");
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
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
      {error && <ErrorState message={error} onRetry={go} />}
      {file && !error && <ConvertButton onClick={go} loading={loading} label="Rotacionar PDF" />}
    </div>
  );
};

export default PdfRotator;