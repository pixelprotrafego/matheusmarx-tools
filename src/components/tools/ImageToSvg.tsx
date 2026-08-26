import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Upload, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { toast } from "sonner";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Falha ao ler arquivo."));
    r.readAsDataURL(file);
  });
}

async function imageToSvgEmbed(file: File): Promise<{ name: string; svg: string }> {
  const dataUrl = await fileToDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close?.();
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image width="${width}" height="${height}" xlink:href="${dataUrl}" href="${dataUrl}"/>
</svg>`;
  return { name: file.name.replace(/\.(jpe?g|png|webp|gif|bmp)$/i, "") + ".svg", svg };
}

async function imageToSvgVector(file: File, numColors: number): Promise<{ name: string; svg: string }> {
  const ImageTracer: any = (await import("imagetracerjs")).default ?? (await import("imagetracerjs"));
  const dataUrl = await fileToDataUrl(file);
  const svg: string = await new Promise((resolve, reject) => {
    ImageTracer.imageToSVG(
      dataUrl,
      (svgStr: string) => resolve(svgStr),
      {
        numberofcolors: numColors,
        ltres: 1,
        qtres: 1,
        pathomit: 8,
        rightangleenhance: true,
        colorsampling: 2,
        mincolorratio: 0,
        blurradius: 0,
      }
    );
    setTimeout(() => reject(new Error("Tempo esgotado na vetorização")), 60000);
  });
  return { name: file.name.replace(/\.(jpe?g|png|webp|gif|bmp)$/i, "") + ".svg", svg };
}

const ImageToSvg = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [vectorize, setVectorize] = useState(true);
  const [numColors, setNumColors] = useState(16);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | File[]) => {
    const valid = Array.from(list).filter((f) => /^image\//.test(f.type) && !/svg/i.test(f.type));
    if (!valid.length) {
      toast.error("Selecione imagens raster (JPG, PNG, WEBP).");
      return;
    }
    setFiles((prev) => [...prev, ...valid]);
  };

  const convert = async () => {
    if (!files.length) return;
    setLoading(true);
    try {
      const run = vectorize
        ? (f: File) => imageToSvgVector(f, numColors)
        : imageToSvgEmbed;
      if (files.length === 1) {
        const { name, svg } = await run(files[0]);
        saveAs(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), name);
      } else {
        const zip = new JSZip();
        for (const f of files) {
          const { name, svg } = await run(f);
          zip.file(name, svg);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, "imagens-svg.zip");
      }
      toast.success("Conversão concluída!");
    } catch (e) {
      toast.error("Falha na conversão", { description: e instanceof Error ? e.message : String(e) });
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
        <p className="text-sm text-muted-foreground">JPG, PNG ou WEBP • Múltiplos arquivos</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
          multiple
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      <div className="space-y-3 rounded-lg bg-secondary/30 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Vetorização real</Label>
            <p className="text-xs text-muted-foreground">
              Gera paths vetoriais (recomendado para logos/ilustrações). Desligue para apenas embutir a imagem raster.
            </p>
          </div>
          <Switch checked={vectorize} onCheckedChange={setVectorize} />
        </div>
        {vectorize && (
          <div className="space-y-1">
            <Label className="text-xs">Número de cores</Label>
            <Select value={String(numColors)} onValueChange={(v) => setNumColors(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2, 4, 8, 16, 32, 64].map((n) => (
                  <SelectItem key={n} value={String(n)}>{n} cores</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Mais cores = mais fiel, mais lento e arquivo maior.</p>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{files.length} arquivo(s) selecionado(s)</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setFiles([])}>Limpar</Button>
            <Button onClick={convert} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Converter para SVG
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageToSvg;