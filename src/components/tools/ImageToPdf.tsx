import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, Loader2, X, GripVertical, ImageIcon } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";
import { bytesToBlob } from "@/lib/download";
import type { PageSize } from "@/lib/image-to-pdf";
import { useAdoptDroppedFile } from "./shared/dropped-file";

interface UploadedImage {
  id: string;
  file: File;
  /** URL de prévia; `null` quando o navegador não consegue exibir (HEIC). */
  preview: string | null;
}

/** Formatos aceitos: o que o navegador decodifica, mais HEIC. */
const ACCEPT = ".jpg,.jpeg,.jfif,.png,.webp,.gif,.bmp,.avif,.heic,.heif";
const ACCEPTED = /\.(jpe?g|jfif|png|webp|gif|bmp|avif|hei[cf])$/i;

const isAccepted = (f: File) => ACCEPTED.test(f.name) || /^image\/(jpeg|png|webp|gif|bmp|avif|hei[cf])$/i.test(f.type);

const ImageToPdf = () => {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>("image");
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());

  // As prévias são URLs de objeto: liberadas ao sair da tela.
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    const valid = list.filter(isAccepted);
    const skipped = list.length - valid.length;
    if (skipped) toast.error(`${skipped} arquivo(s) ignorado(s): formato de imagem não suportado.`);
    const loaded = valid.map((file) => {
      const heic = /\.hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
      const preview = heic ? null : URL.createObjectURL(file);
      if (preview) urls.current.add(preview);
      return { id: crypto.randomUUID(), file, preview };
    });
    setImages((prev) => [...prev, ...loaded]);
  }, []);

  useAdoptDroppedFile((f) => addFiles([f]));

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const gone = prev.find((img) => img.id === id);
      if (gone?.preview) {
        URL.revokeObjectURL(gone.preview);
        urls.current.delete(gone.preview);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  const handleReorderDragStart = (index: number) => {
    setDragIndex(index);
  };

  const handleReorderDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
    setImages((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(dragIndex, 1);
      updated.splice(index, 0, moved);
      return updated;
    });
    setDragIndex(index);
  };

  const handleReorderDragEnd = () => {
    setDragIndex(null);
  };

  const generatePdf = async () => {
    if (images.length === 0) return;
    const batchErr = checkBatch(images.length, BATCH_LIMITS.imagesPerBatch, "imagens");
    if (batchErr) { toast.error(batchErr); return; }
    setLoading(true);

    try {
      const { imagesToPdf } = await import("@/lib/image-to-pdf");
      const bytes = await imagesToPdf(images.map((i) => i.file), {
        pageSize,
        margin: pageSize === "image" ? 0 : 28.35,
        onProgress: (done, total) => setProgress(`${done}/${total}`),
      });
      const name = images.length === 1 ? images[0].file.name.replace(/\.[^.]+$/, "") + ".pdf" : "imagens-convertidas.pdf";
      saveAs(bytesToBlob(bytes, "application/pdf"), name);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erro desconhecido";
      toast.error("Falha ao gerar o PDF", { description: msg });
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const reset = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current.clear();
    setImages([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-foreground font-heading mb-1">Arraste suas imagens aqui</p>
        <p className="text-sm text-muted-foreground">JPG, PNG, WEBP, GIF, BMP, AVIF ou HEIC • Múltiplos arquivos</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {images.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label>Tamanho da página</Label>
              <Select value={pageSize} onValueChange={(v) => setPageSize(v as PageSize)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Igual ao da imagem</SelectItem>
                  <SelectItem value="a4">A4, com a imagem ajustada</SelectItem>
                  <SelectItem value="letter">Carta, com a imagem ajustada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                <X className="w-4 h-4 mr-1" /> Limpar
              </Button>
              <Button onClick={generatePdf} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {loading && progress ? `Gerando ${progress}` : "Gerar PDF"}
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{images.length} imagem(ns) • Arraste para reordenar</p>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {images.map((img, index) => (
              <Card
                key={img.id}
                draggable
                onDragStart={() => handleReorderDragStart(index)}
                onDragOver={(e) => handleReorderDragOver(e, index)}
                onDragEnd={handleReorderDragEnd}
                className={`overflow-hidden bg-card border-border hover:border-primary/50 transition-all cursor-grab active:cursor-grabbing ${
                  dragIndex === index ? "opacity-50 scale-95" : ""
                }`}
              >
                <CardContent className="p-2">
                  <div className="relative">
                    {img.preview ? (
                      <img src={img.preview} alt={`Imagem ${index + 1}`} className="w-full h-32 object-cover rounded" />
                    ) : (
                      <div className="w-full h-32 rounded bg-muted flex items-center justify-center">
                        <ImageIcon className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                      className="absolute top-1 right-1 bg-background/80 rounded-full p-1 hover:bg-destructive/80 transition-colors"
                      aria-label={`Remover ${img.file.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <div className="absolute top-1 left-1 bg-background/80 rounded-full p-1">
                      <GripVertical className="w-3 h-3 text-muted-foreground" />
                    </div>
                  </div>
                  <p className="text-xs text-center mt-2 text-muted-foreground truncate">{img.file.name}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageToPdf;
