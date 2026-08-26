import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import { fileToImage, drawToCanvas, canvasToBlob } from "@/lib/canvas-utils";
import { downloadAsZip } from "@/lib/download";
import { ImageIcon } from "lucide-react";

const SIZES = [16, 32, 48, 96, 180, 192, 512];

const FaviconGenerator = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const img = await fileToImage(file);
      if (img.width < 256 || img.height < 256) {
        toast.message("Imagem pequena", {
          description: `Ideal: ≥256×256. Sua imagem: ${img.width}×${img.height} — favicons grandes serão upscale e podem ficar borrados.`,
        });
      }
      const files: { name: string; blob: Blob }[] = [];
      for (const s of SIZES) {
        const canvas = drawToCanvas(img, s, s);
        const blob = await canvasToBlob(canvas, "image/png");
        files.push({ name: `favicon-${s}x${s}.png`, blob });
      }
      const manifest = {
        name: "App",
        short_name: "App",
        icons: SIZES.map((s) => ({ src: `favicon-${s}x${s}.png`, sizes: `${s}x${s}`, type: "image/png" })),
      };
      files.push({ name: "manifest.json", blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) });
      await downloadAsZip(files, "favicons.zip");
      toast.success("Pacote de favicons pronto!");
      setFile(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Erro"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {!file ? <Dropzone onFiles={(fs) => setFile(fs[0])} accept="image/*" title="Arraste imagem (preferencialmente quadrada)" /> :
        <FileBadge file={file} icon={<ImageIcon className="w-4 h-4 text-primary" />} onRemove={() => setFile(null)} />}
      {error && <ErrorState message={error} onRetry={go} />}
      {file && !error && <ConvertButton onClick={go} loading={loading} label="Gerar pacote de favicons" />}
    </div>
  );
};

export default FaviconGenerator;