import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import JSZip from "jszip";

const JfifToImage = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith(".jfif")
    );
    setFiles((prev) => [...prev, ...valid]);
  };

  const rasterize = async (file: File): Promise<Blob> => {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((res) =>
      canvas.toBlob((b) => res(b!), `image/${format}`, 0.95)
    );
  };

  const convert = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      if (files.length === 1) {
        const blob = await rasterize(files[0]);
        saveAs(blob, files[0].name.replace(/\.jfif$/i, `.${format}`));
        return;
      }
      const zip = new JSZip();
      for (const file of files) {
        const blob = await rasterize(file);
        zip.file(file.name.replace(/\.jfif$/i, `.${format}`), blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, "jfif-convertidos.zip");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-4 items-center">
        <label className="text-sm text-muted-foreground">Formato de saída:</label>
        <Button variant={format === "png" ? "default" : "outline"} size="sm" onClick={() => setFormat("png")}>PNG</Button>
        <Button variant={format === "jpeg" ? "default" : "outline"} size="sm" onClick={() => setFormat("jpeg")}>JPEG</Button>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-foreground font-heading mb-1">Arraste seus arquivos JFIF aqui</p>
        <p className="text-sm text-muted-foreground">Múltiplos arquivos suportados</p>
        <input ref={inputRef} type="file" accept=".jfif" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} className="hidden" />
      </div>
      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{files.length} arquivo(s) selecionado(s)</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setFiles([])}>Limpar</Button>
            <Button onClick={convert} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Converter para {format.toUpperCase()}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default JfifToImage;
