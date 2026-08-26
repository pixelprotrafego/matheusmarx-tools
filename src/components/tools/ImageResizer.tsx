import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fileToImage, drawToCanvas, canvasToBlob } from "@/lib/canvas-utils";
import { downloadBlob, downloadAsZip, replaceExt } from "@/lib/download";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";
import { ImageIcon } from "lucide-react";

const ImageResizer = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [keepRatio, setKeepRatio] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!files.length) return;
    const batchErr = checkBatch(files.length, BATCH_LIMITS.imagesPerBatch, "imagens");
    if (batchErr) { toast.error(batchErr); return; }
    setLoading(true); setError(null); setProgress(0);
    try {
      const out: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < files.length; i++) {
        const img = await fileToImage(files[i]);
        let w = width, h = height;
        if (keepRatio) {
          const ratio = img.naturalWidth / img.naturalHeight;
          h = Math.round(w / ratio);
        }
        const canvas = drawToCanvas(img, w, h);
        const blob = await canvasToBlob(canvas, "image/png");
        out.push({ name: replaceExt(files[i].name, "png"), blob });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }
      if (out.length === 1) downloadBlob(out[0].blob, out[0].name);
      else await downloadAsZip(out, "resized.zip");
      toast.success("Redimensionado!");
      setFiles([]);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!files.length ? <Dropzone onFiles={setFiles} accept="image/*" multiple title="Arraste imagens" /> :
        <div className="space-y-2">{files.map((f, i) => <FileBadge key={i} file={f} icon={<ImageIcon className="w-4 h-4 text-primary" />} onRemove={() => setFiles(files.filter((_, k) => k !== i))} />)}</div>}
      {files.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-2"><Label>Largura (px)</Label><Input type="number" value={width} onChange={(e) => setWidth(+e.target.value)} /></div>
          <div className="space-y-2"><Label>Altura (px)</Label><Input type="number" value={height} onChange={(e) => setHeight(+e.target.value)} disabled={keepRatio} /></div>
          <div className="space-y-2"><Label>Manter proporção</Label><div><Switch checked={keepRatio} onCheckedChange={setKeepRatio} /></div></div>
        </div>
      )}
      {loading && <ProgressState progress={progress} />}
      {error && !loading && <ErrorState message={error} onRetry={go} />}
      {files.length > 0 && !loading && !error && <ConvertButton onClick={go} label="Redimensionar" />}
    </div>
  );
};

export default ImageResizer;