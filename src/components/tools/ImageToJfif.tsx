import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import JSZip from "jszip";

const ImageToJfif = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) =>
      ["image/jpeg", "image/png", "image/jpg"].includes(f.type)
    );
    setFiles((prev) => [...prev, ...valid]);
  };

  const convert = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      // JFIF is essentially JPEG, so we convert to JPEG blob and rename
      if (files.length === 1) {
        const bitmap = await createImageBitmap(files[0]);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        canvas.toBlob(
          (b) => {
            if (b) saveAs(b, files[0].name.replace(/\.(jpe?g|png)$/i, ".jfif"));
          },
          "image/jpeg",
          0.95
        );
      } else {
        const zip = new JSZip();
        for (const file of files) {
          const bitmap = await createImageBitmap(file);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0);
          const blob = await new Promise<Blob>((res) =>
            canvas.toBlob((b) => res(b!), "image/jpeg", 0.95)
          );
          zip.file(file.name.replace(/\.(jpe?g|png)$/i, ".jfif"), blob);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, "imagens-jfif.zip");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
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
        <p className="text-foreground font-heading mb-1">Arraste suas imagens aqui</p>
        <p className="text-sm text-muted-foreground">JPG, JPEG ou PNG • Múltiplos arquivos</p>
        <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png" multiple onChange={(e) => e.target.files && handleFiles(e.target.files)} className="hidden" />
      </div>
      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{files.length} arquivo(s) selecionado(s)</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setFiles([])}>Limpar</Button>
            <Button onClick={convert} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Converter para JFIF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageToJfif;
