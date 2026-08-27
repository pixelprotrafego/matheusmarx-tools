import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, Download, Loader2, X, GripVertical } from "lucide-react";
import jsPDF from "jspdf";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";

interface UploadedImage {
  id: string;
  file: File;
  preview: string;
  width: number;
  height: number;
}

const ImageToPdf = () => {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadImage = (file: File): Promise<UploadedImage> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          resolve({
            id: crypto.randomUUID(),
            file,
            preview: e.target!.result as string,
            width: img.width,
            height: img.height,
          });
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((f) =>
      ["image/jpeg", "image/jpg", "image/png"].includes(f.type)
    );
    const loaded = await Promise.all(validFiles.map(loadImage));
    setImages((prev) => [...prev, ...loaded]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
  };

  const removeImage = (id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
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
      const first = images[0];
      const pdf = new jsPDF({
        orientation: first.width > first.height ? "landscape" : "portrait",
        unit: "px",
        format: [first.width, first.height],
      });

      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (i > 0) {
          pdf.addPage([img.width, img.height], img.width > img.height ? "landscape" : "portrait");
        }
        pdf.addImage(img.preview, "JPEG", 0, 0, img.width, img.height);
      }

      const blob = pdf.output("blob");
      saveAs(blob, "imagens-convertidas.pdf");
    } catch (error) {
      console.error("Error generating PDF:", error);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
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
        <p className="text-sm text-muted-foreground">JPG, JPEG ou PNG • Múltiplos arquivos</p>
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>

      {images.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{images.length} imagem(ns) • Arraste para reordenar</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={reset}>
                <X className="w-4 h-4 mr-1" /> Limpar
              </Button>
              <Button onClick={generatePdf} disabled={loading} className="gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Gerar PDF
              </Button>
            </div>
          </div>

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
                    <img src={img.preview} alt={`Imagem ${index + 1}`} className="w-full h-32 object-cover rounded" />
                    <button
                      onClick={(e) => { e.stopPropagation(); removeImage(img.id); }}
                      className="absolute top-1 right-1 bg-background/80 rounded-full p-1 hover:bg-destructive/80 transition-colors"
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
