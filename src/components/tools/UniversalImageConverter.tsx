import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { fileToImage, drawToCanvas, canvasToBlob, supportsImageType } from "@/lib/canvas-utils";
import { downloadBlob, downloadAsZip, replaceExt } from "@/lib/download";
import { rasterizeSvg } from "@/lib/svg-utils";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";
import { ImageIcon } from "lucide-react";

interface Props {
  inputAccept: string;
  inputLabel: string;
  inputExt: string;          // e.g. "webp", "image", "heic", "svg", "bmp"
  outputExt: string;          // e.g. "png", "jpg", "webp", "avif", "bmp", "ico", "gif", "jfif"
  outputMime?: string;        // override (jfif -> image/jpeg)
  background?: string;        // for jpg conversion of transparent images
}

const MIME_FOR_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
};

async function loadAsImage(file: File, inputExt: string) {
  if (inputExt === "svg") {
    const { canvas } = await rasterizeSvg(file, 2, "image/png");
    return { canvas };
  }
  if (inputExt === "heic" || /\.hei[cf]$/i.test(file.name)) {
    const heic2any = (await import("heic2any")).default;
    const out = (await heic2any({ blob: file, toType: "image/png" })) as Blob;
    const img = await fileToImage(out);
    return { canvas: drawToCanvas(img) };
  }
  const img = await fileToImage(file);
  return { canvas: drawToCanvas(img) };
}

const UniversalImageConverter = ({
  inputAccept,
  inputLabel,
  inputExt,
  outputExt,
  outputMime,
  background,
}: Props) => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const targetMime = outputMime ?? MIME_FOR_EXT[outputExt] ?? "image/png";

  const reset = () => { setFiles([]); setError(null); setProgress(0); };

  const convert = async () => {
    if (!files.length) return;
    const batchErr = checkBatch(files.length, BATCH_LIMITS.imagesPerBatch, "imagens");
    if (batchErr) { toast.error(batchErr); setError(batchErr); return; }
    setLoading(true); setError(null); setProgress(0);
    try {
      // For ICO produce 256x256 favicon-ish file via PNG embed
      const needsBg = outputExt === "jpg" || outputExt === "jpeg" || outputExt === "jfif" || outputExt === "bmp";
      const bg = background ?? (needsBg ? "#ffffff" : undefined);

      let effectiveMime = targetMime;
      // Chromium não codifica BMP nem GIF via canvas.toBlob; AVIF depende do build.
      // Se o navegador não suportar o MIME alvo, caímos para PNG com aviso ao usuário.
      if (
        (outputExt === "avif" || outputExt === "bmp" || outputExt === "gif") &&
        !(await supportsImageType(targetMime))
      ) {
        toast.message(
          `Seu navegador não suporta gerar ${outputExt.toUpperCase()} diretamente. Salvando como PNG.`,
        );
        effectiveMime = "image/png";
      }

      const results: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const { canvas } = await loadAsImage(f, inputExt);

        let outCanvas = canvas;
        if (outputExt === "ico") {
          outCanvas = drawToCanvas(await fileToImage(await canvasToBlob(canvas, "image/png")), 256, 256, bg);
        } else if (bg) {
          outCanvas = drawToCanvas(await fileToImage(await canvasToBlob(canvas, "image/png")), canvas.width, canvas.height, bg);
        }

        const blob = await canvasToBlob(outCanvas, effectiveMime, 0.92);
        const finalExt = effectiveMime === "image/png" && outputExt !== "png" ? "png" : outputExt;
        results.push({ name: replaceExt(f.name, finalExt), blob });
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      if (results.length === 1) downloadBlob(results[0].blob, results[0].name);
      else await downloadAsZip(results, `converted-${outputExt}.zip`);

      toast.success("Conversão concluída!");
      reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!files.length ? (
        <Dropzone
          onFiles={setFiles}
          accept={inputAccept}
          multiple
          title={`Arraste arquivos ${inputLabel}`}
          hint={`Saída: ${outputExt.toUpperCase()}`}
        />
      ) : (
        <div className="space-y-2">
          {files.map((f, i) => (
            <FileBadge
              key={`${f.name}-${i}`}
              file={f}
              icon={<ImageIcon className="w-4 h-4 text-primary" />}
              onRemove={() => setFiles(files.filter((_, k) => k !== i))}
            />
          ))}
        </div>
      )}

      {loading && <ProgressState progress={progress} status="Convertendo..." />}
      {error && !loading && <ErrorState message={error} onRetry={convert} />}
      {files.length > 0 && !loading && !error && (
        <ConvertButton onClick={convert} label={`Converter para ${outputExt.toUpperCase()}`} />
      )}
    </div>
  );
};

export default UniversalImageConverter;