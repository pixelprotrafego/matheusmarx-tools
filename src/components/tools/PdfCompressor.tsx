import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { downloadBlob, replaceExt, bytesToBlob } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { keepOpenPassword, loadPdfLib, openPdf } from "@/lib/pdf-unlock";
import {
  deflateUncompressedStreams,
  dropUnreachableObjects,
  isRecompressibleJpeg,
  stripMetadata,
} from "@/lib/pdf-cleanup";
import { FileText } from "lucide-react";

/**
 * Recomprime um JPEG pelo canvas. Devolve `null` quando não compensa ou quando
 * o resultado não seria a mesma imagem — e aí o original fica no PDF.
 */
async function recompressJpeg(raw: Uint8Array, width: number, height: number, quality: number): Promise<Uint8Array | null> {
  try {
    const blob = new Blob([raw.slice().buffer], { type: "image/jpeg" });
    // Sem conversão de cor: os bytes continuam no espaço de cor que o PDF
    // declara para a imagem (inclusive o perfil ICC).
    const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none" }).catch(() => null);
    if (!bmp) return null;
    // Um JPEG com orientação EXIF volta girado do decodificador; o PDF ignora
    // o EXIF e desenha os pixels na ordem gravada. Dimensão trocada = não mexe.
    if (bmp.width !== width || bmp.height !== height) {
      bmp.close?.();
      return null;
    }
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close?.();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", quality / 100));
    canvas.width = 0;
    canvas.height = 0;
    if (!out) return null;
    const bytes = new Uint8Array(await out.arrayBuffer());
    return bytes.byteLength < raw.byteLength ? bytes : null;
  } catch {
    return null;
  }
}

const PdfCompressor = () => {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState(70);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedKb, setSavedKb] = useState<number | null>(null);
  const pdfPassword = usePdfPassword();

  const chooseFile = (f: File | null) => {
    setFile(f);
    setError(null);
    setSavedKb(null);
    pdfPassword.reset();
  };

  const go = async (password = pdfPassword.password) => {
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
      const lib = await loadPdfLib();
      const { PDFName, PDFNumber, PDFRawStream } = lib;
      const original = await file.arrayBuffer();
      const opened = await openPdf(original, password, { updateMetadata: false });
      const pdf = opened.doc;

      let images = 0;
      for (const [ref, obj] of pdf.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        if (!isRecompressibleJpeg(lib, pdf, obj.dict)) continue;
        const w = obj.dict.lookup(PDFName.of("Width"));
        const h = obj.dict.lookup(PDFName.of("Height"));
        if (!(w instanceof PDFNumber) || !(h instanceof PDFNumber)) continue;
        const replaced = await recompressJpeg(obj.contents, w.asNumber(), h.asNumber(), quality);
        if (!replaced) continue;
        pdf.context.assign(ref, PDFRawStream.of(obj.dict, replaced));
        images++;
      }

      stripMetadata(lib, pdf);
      deflateUncompressedStreams(lib, pdf);
      dropUnreachableObjects(lib, pdf);
      keepOpenPassword(opened);

      const bytes = await pdf.save({ useObjectStreams: true });
      const saved = (original.byteLength - bytes.byteLength) / 1024;
      if (saved <= 0) {
        // Entregar um arquivo maior que o original com o nome de "comprimido"
        // seria pior do que não entregar nada.
        toast.info("Este PDF já está compacto: não houve como reduzir o tamanho dele.");
        return;
      }
      setSavedKb(saved);
      downloadBlob(bytesToBlob(bytes, "application/pdf"),
        replaceExt(file.name, "pdf").replace(/\.pdf$/, ".compressed.pdf"));
      toast.success(`PDF reduzido em ${saved.toFixed(1)} KB (${images} imagem(ns) recomprimida(s))`);
    } catch (e) {
      if (!pdfPassword.catchPassword(e)) setError(e instanceof Error ? e.message : "Erro");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => chooseFile(fs[0])} accept="application/pdf,.pdf" title="Arraste o PDF" /> :
        <FileBadge file={file} icon={<FileText className="w-4 h-4 text-primary" />} onRemove={() => chooseFile(null)} />}
      {file && (
        <div className="space-y-2">
          <Label>Qualidade JPEG: {quality}%</Label>
          <Slider value={[quality]} onValueChange={(v) => setQuality(v[0])} min={30} max={95} step={5} />
          <p className="text-xs text-muted-foreground">Recomprime imagens JPEG embarcadas e remove metadados.</p>
        </div>
      )}
      {savedKb != null && <p className="text-sm text-primary">Economia: {savedKb.toFixed(1)} KB</p>}
      {pdfPassword.request && (
        <PdfPasswordPrompt
          reason={pdfPassword.request}
          busy={loading}
          onSubmit={(pw) => { pdfPassword.provide(pw); void go(pw); }}
        />
      )}
      {error && <ErrorState message={error} onRetry={() => go()} />}
      {file && !error && !pdfPassword.request && <ConvertButton onClick={() => go()} loading={loading} label="Comprimir PDF" />}
    </div>
  );
};

export default PdfCompressor;
