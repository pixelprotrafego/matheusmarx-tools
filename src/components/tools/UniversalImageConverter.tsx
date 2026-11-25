import { useState } from "react";
import { toast } from "sonner";
import Dropzone from "./shared/Dropzone";
import FileBadge from "./shared/FileBadge";
import ConvertButton from "./shared/ConvertButton";
import ErrorState from "./shared/ErrorState";
import ProgressState from "./shared/ProgressState";
import { fileToImage, drawToCanvas, canvasToBlob, supportsImageType } from "@/lib/canvas-utils";
import { downloadBlob, downloadAsZip, replaceExt, bytesToBlob } from "@/lib/download";
import { rasterizeSvg } from "@/lib/svg-utils";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";
import { ImageIcon } from "lucide-react";
import { useAdoptDroppedFile } from "./shared/dropped-file";

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
    const out = await heic2any({ blob: file, toType: "image/png" });
    // HEIC com várias imagens (sequência, Live Photo) volta como lista: vale a primeira.
    const img = await fileToImage(Array.isArray(out) ? out[0] : out);
    return { canvas: drawToCanvas(img) };
  }
  const img = await fileToImage(file);
  return { canvas: drawToCanvas(img) };
}

const pixelsOf = (canvas: HTMLCanvasElement) =>
  canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);

/**
 * Grava o canvas no formato pedido. BMP, GIF e ICO têm codificador próprio
 * (o navegador não grava nenhum deles); AVIF usa o do navegador quando há e,
 * senão, um codificador em WebAssembly carregado só nessa hora.
 */
async function encodeCanvas(canvas: HTMLCanvasElement, ext: string, mime: string): Promise<Blob> {
  const enc = await import("@/lib/image-encoders");
  if (ext === "bmp") return bytesToBlob(enc.encodeBmp(pixelsOf(canvas)), "image/bmp");
  if (ext === "gif") return bytesToBlob(enc.encodeGif(pixelsOf(canvas)), "image/gif");
  if (ext === "ico") {
    const largest = Math.max(canvas.width, canvas.height);
    const sizes = enc.ICO_SIZES.filter((s) => s <= Math.max(48, largest));
    const entries = await Promise.all(
      sizes.map(async (size) => {
        const square = enc.fitSquare(canvas, size);
        const png = size > 64 ? new Uint8Array(await (await canvasToBlob(square, "image/png")).arrayBuffer()) : undefined;
        return { size, pixels: pixelsOf(square), png };
      }),
    );
    return bytesToBlob(enc.encodeIco(entries), "image/x-icon");
  }
  if (ext === "avif" && !(await supportsImageType("image/avif"))) {
    const encode = (await import("@jsquash/avif/encode")).default;
    return new Blob([await encode(pixelsOf(canvas), { quality: 75, speed: 6 })], { type: "image/avif" });
  }
  return canvasToBlob(canvas, mime, 0.92);
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

  useAdoptDroppedFile((f) => setFiles([f]));

  const targetMime = outputMime ?? MIME_FOR_EXT[outputExt] ?? "image/png";

  const reset = () => { setFiles([]); setError(null); setProgress(0); };

  const convert = async () => {
    if (!files.length) return;
    const batchErr = checkBatch(files.length, BATCH_LIMITS.imagesPerBatch, "imagens");
    if (batchErr) { toast.error(batchErr); setError(batchErr); return; }
    setLoading(true); setError(null); setProgress(0);
    try {
      // JPEG e BMP não têm transparência: fundo branco, como nos editores.
      const needsBg = outputExt === "jpg" || outputExt === "jpeg" || outputExt === "jfif" || outputExt === "bmp";
      const bg = background ?? (needsBg ? "#ffffff" : undefined);

      // WEBP é o único que pode faltar no navegador (Safari antigo) e não tem
      // codificador próprio aqui: nesse caso o usuário é avisado.
      let finalExt = outputExt;
      let mime = targetMime;
      if (outputExt === "webp" && !(await supportsImageType("image/webp"))) {
        toast.message("Seu navegador não grava WEBP. Salvando como PNG.");
        finalExt = "png";
        mime = "image/png";
      }

      const results: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        // JPEG para JPG ou JFIF é o mesmo formato: os bytes vão como estão,
        // sem recomprimir (cada recompressão perde qualidade).
        if (finalExt === "jpg" || finalExt === "jpeg" || finalExt === "jfif") {
          const head = new Uint8Array(await f.slice(0, 3).arrayBuffer());
          if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
            results.push({ name: replaceExt(f.name, finalExt), blob: new Blob([await f.arrayBuffer()], { type: "image/jpeg" }) });
            setProgress(Math.round(((i + 1) / files.length) * 100));
            continue;
          }
        }
        const { canvas } = await loadAsImage(f, inputExt);
        const outCanvas = bg ? drawToCanvas(canvas, canvas.width, canvas.height, bg) : canvas;
        const blob = await encodeCanvas(outCanvas, finalExt, mime);
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