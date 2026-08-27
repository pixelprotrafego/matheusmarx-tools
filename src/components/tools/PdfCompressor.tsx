import { useState } from "react";
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from "pdf-lib";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { FileText } from "lucide-react";

const PdfCompressor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(70);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedKb, setSavedKb] = useState<number | null>(null);

  const recompressJpegStream = async (stream: PDFRawStream, q: number): Promise<Uint8Array | null> => {
    try {
      const raw = stream.contents;
      const blob = new Blob([raw.slice().buffer], { type: "image/jpeg" });
      const bmp = await createImageBitmap(blob).catch(() => null);
      if (!bmp) return null;
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width; canvas.height = bmp.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      const out = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", q / 100)
      );
      if (!out) return null;
      const newBytes = new Uint8Array(await out.arrayBuffer());
      return newBytes.byteLength < raw.byteLength ? newBytes : null;
    } catch { return null; }
  };

  const go = async () => {
    if (!file) return;
    const rl = guard("pdf-compress", { hourly: 15, daily: 60 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : {
        description: `Tente novamente em ${formatReset(rl.resetInMs)}.`,
      });
      return;
    }
    setLoading(true); setError(null); setSavedKb(null);
    try {
      const original = await file.arrayBuffer();
      const pdf = await PDFDocument.load(original, { updateMetadata: false });

      // Recompressão real de imagens JPEG embarcadas.
      let processed = 0;
      const indirects = pdf.context.enumerateIndirectObjects();
      for (const [ref, obj] of indirects) {
        if (!(obj instanceof PDFRawStream)) continue;
        const dict = obj.dict as PDFDict;
        const subtype = dict.get(PDFName.of("Subtype"));
        const filter = dict.get(PDFName.of("Filter"));
        const isImage = subtype?.toString() === "/Image";
        const isDct = filter?.toString().includes("DCTDecode");
        if (!isImage || !isDct) continue;
        const replaced = await recompressJpegStream(obj, quality);
        if (replaced) {
          // Reescreve o stream com bytes menores. pdf-lib exporta PDFRawStream.of.
          const newStream = PDFRawStream.of(dict, replaced);
          pdf.context.assign(ref, newStream);
          processed++;
        }
      }

      pdf.setTitle(""); pdf.setAuthor(""); pdf.setSubject(""); pdf.setKeywords([]);
      pdf.setProducer(""); pdf.setCreator("");
      const bytes = await pdf.save({ useObjectStreams: true });
      const saved = (original.byteLength - bytes.byteLength) / 1024;
      setSavedKb(saved);
      downloadBlob(bytesToBlob(bytes, "application/pdf"),
        replaceExt(file.name, "pdf").replace(/\.pdf$/, ".compressed.pdf"));
      toast.success(`PDF reduzido em ${saved.toFixed(1)} KB (${processed} imagem(ns) recomprimida(s))`);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {file && (
        <div className="space-y-2">
          <Label>Qualidade JPEG: {quality}%</Label>
          <Slider value={[quality]} onValueChange={(v) => setQuality(v[0])} min={30} max={95} step={5} />
          <p className="text-xs text-muted-foreground">Recomprime imagens JPEG embarcadas e remove metadados.</p>
        </div>
      )}
      {savedKb != null && <p className="text-sm text-primary">Economia: {savedKb.toFixed(1)} KB</p>}
      {error && <ErrorState message={error} onRetry={go} />}
      {file && !error && <ConvertButton onClick={go} loading={loading} label="Comprimir PDF" />}
    </div>
  );
};

export default PdfCompressor;