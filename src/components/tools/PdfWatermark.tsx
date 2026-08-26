import { useState } from "react";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { FileText } from "lucide-react";

const PdfWatermark = () => {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("CONFIDENCIAL");
  const [opacity, setOpacity] = useState(30);
  const [angle, setAngle] = useState(45);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    const rl = guard("pdf-watermark", { hourly: 20, daily: 80 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null);
    try {
      const pdf = await PDFDocument.load(await file.arrayBuffer());
      const font = await pdf.embedFont(StandardFonts.HelveticaBold);
      const pages = pdf.getPages();
      for (const p of pages) {
        const { width, height } = p.getSize();
        const fontSize = Math.min(width, height) * 0.12;
        const tw = font.widthOfTextAtSize(text, fontSize);
        p.drawText(text, {
          x: width / 2 - tw / 2,
          y: height / 2 - fontSize / 2,
          font, size: fontSize,
          color: rgb(0.85, 0.7, 0.2),
          opacity: opacity / 100,
          rotate: degrees(angle),
        });
      }
      const bytes = await pdf.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"), replaceExt(file.name, "pdf"));
      toast.success("Marca d'água aplicada!");
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {file && (
        <div className="space-y-4">
          <div className="space-y-2"><Label>Texto</Label><Input value={text} onChange={(e) => setText(e.target.value)} /></div>
          <div className="space-y-2"><Label>Opacidade: {opacity}%</Label>
            <Slider value={[opacity]} onValueChange={(v) => setOpacity(v[0])} min={10} max={100} step={5} />
          </div>
          <div className="space-y-2"><Label>Rotação: {angle}°</Label>
            <Slider value={[angle]} onValueChange={(v) => setAngle(v[0])} min={0} max={90} step={5} />
          </div>
        </div>
      )}
      {error && <ErrorState message={error} onRetry={go} />}
      {file && !error && <ConvertButton onClick={go} loading={loading} label="Aplicar marca d'água" />}
    </div>
  );
};

export default PdfWatermark;