import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fileToImage, drawToCanvas, canvasToBlob } from "@/lib/canvas-utils";
import { downloadBlob, downloadAsZip, replaceExt } from "@/lib/download";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";
import { ImageIcon } from "lucide-react";

const ImageCompressor = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(75);
  const [format, setFormat] = useState<"jpeg" | "webp">("jpeg");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!files.length) return;
    const batchErr = checkBatch(files.length, BATCH_LIMITS.imagesPerBatch, "imagens");
    if (batchErr) { toast.error(batchErr); return; }
    if (files.length > 5) {
      const rl = guard("image-compress", { hourly: 20, daily: 80 });
      if (!rl.ok) {
        toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
        return;
      }
    }
    setLoading(true); setError(null); setProgress(0);
    try {
      const out: { name: string; blob: Blob }[] = [];
      let saved = 0;
      for (let i = 0; i < files.length; i++) {
        const img = await fileToImage(files[i]);
        const canvas = drawToCanvas(img, undefined, undefined, format === "jpeg" ? "#ffffff" : undefined);
        const blob = await canvasToBlob(canvas, `image/${format}`, quality / 100);
        saved += files[i].size - blob.size;
        out.push({ name: replaceExt(files[i].name, format), blob });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      if (out.length === 1) downloadBlob(out[0].blob, out[0].name);
      else await downloadAsZip(out, "compressed.zip");
      toast.success(`Economia: ${(saved / 1024).toFixed(1)} KB`);
      setFiles([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!files.length ? <Dropzone onFiles={setFiles} accept="image/*" multiple title="Arraste imagens" /> :
        <div className="space-y-2">{files.map((f, i) => <FileBadge key={i} file={f} icon={<ImageIcon className="w-4 h-4 text-primary" />} onRemove={() => setFiles(files.filter((_, k) => k !== i))} />)}</div>}
      {files.length > 0 && (
        <div className="space-y-4">
          <div className="space-y-2"><Label>Qualidade: {quality}%</Label><Slider value={[quality]} onValueChange={(v) => setQuality(v[0])} min={20} max={95} step={5} /></div>
          <div className="space-y-2"><Label>Formato</Label>
            <Select value={format} onValueChange={(v: any) => setFormat(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="jpeg">JPEG</SelectItem>
                <SelectItem value="webp">WEBP</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {loading && <ProgressState progress={progress} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {files.length > 0 && !loading && !error && <ConvertButton onClick={go} label="Comprimir" />}
    </div>
  );
};

export default ImageCompressor;