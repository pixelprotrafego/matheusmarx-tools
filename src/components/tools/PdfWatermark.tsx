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
import { Slider } from "@/components/ui/slider";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { keepOpenPassword, loadPdfLib, openPdf } from "@/lib/pdf-unlock";
import { watermarkPlacement } from "@/lib/watermark";
import { FileText } from "lucide-react";

const PdfWatermark = () => {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("CONFIDENCIAL");
  const [opacity, setOpacity] = useState(30);
  const [angle, setAngle] = useState(45);
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
    if (!text.trim()) { setError("Digite o texto da marca d'água."); return; }
    const rl = guard("pdf-watermark", { hourly: 20, daily: 80 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true); setError(null);
    try {
      const { StandardFonts, rgb, degrees } = await loadPdfLib();
      const opened = await openPdf(await file.arrayBuffer(), password);
      const font = await opened.doc.embedFont(StandardFonts.HelveticaBold);

      let unitWidth: number;
      try {
        unitWidth = font.widthOfTextAtSize(text, 1);
      } catch {
        // As 14 fontes padrão do PDF só codificam o alfabeto latino (WinAnsi).
        throw new Error("A marca d'água aceita letras, números, acentos e pontuação comum; tire símbolos especiais ou emoji do texto.");
      }
      // Altura acima da linha de base (0,718 em na Helvetica Bold, que é a
      // altura das maiúsculas): é o que o olho mede como "altura do texto" ao
      // centralizar, e não o corpo inteiro com as descendentes.
      const capHeight = font.heightAtSize(1, { descender: false });

      for (const page of opened.doc.getPages()) {
        // A área visível é a CropBox, que nem sempre começa em (0, 0): em PDF
        // recortado ou escaneado o centro da MediaBox fica fora do lugar.
        const box = page.getCropBox();
        const placement = watermarkPlacement({
          pageWidth: box.width,
          pageHeight: box.height,
          pageRotation: page.getRotation().angle,
          angle,
          unitWidth,
          unitCapHeight: capHeight,
        });
        page.drawText(text, {
          x: box.x + placement.x,
          y: box.y + placement.y,
          font,
          size: placement.size,
          color: rgb(0.85, 0.7, 0.2),
          opacity: opacity / 100,
          rotate: degrees(placement.rotate),
        });
      }
      keepOpenPassword(opened);
      const bytes = await opened.doc.save();
      downloadBlob(bytesToBlob(bytes, "application/pdf"), replaceExt(file.name, "pdf"));
      toast.success("Marca d'água aplicada!");
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
      {pdfPassword.request && (
        <PdfPasswordPrompt
          reason={pdfPassword.request}
          busy={loading}
          onSubmit={(pw) => { pdfPassword.provide(pw); void go(pw); }}
        />
      )}
      {error && <ErrorState message={error} onRetry={() => go()} />}
      {file && !error && !pdfPassword.request && <ConvertButton onClick={() => go()} loading={loading} label="Aplicar marca d'água" />}
    </div>
  );
};

export default PdfWatermark;
