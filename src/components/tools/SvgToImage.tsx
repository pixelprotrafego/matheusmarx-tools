import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";

async function rasterizeSvg(file: File, scale: number, format: "png" | "jpeg"): Promise<Blob> {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement as unknown as SVGSVGElement;

  let width = parseFloat(svg.getAttribute("width") || "0");
  let height = parseFloat(svg.getAttribute("height") || "0");
  const viewBox = svg.getAttribute("viewBox");
  if ((!width || !height) && viewBox) {
    const parts = viewBox.split(/\s+|,/).map(Number);
    if (parts.length === 4) {
      width = width || parts[2];
      height = height || parts[3];
    }
  }
  if (!width || !height) {
    width = 1024;
    height = 1024;
  }

  const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Falha ao carregar o SVG."));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Falha ao gerar imagem."))), `image/${format}`, 0.95)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SvgToImage = () => {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [scale, setScale] = useState<string>("2");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = (f?: File | null) => {
    if (!f) return;
    if (!/svg/i.test(f.type) && !/\.svg$/i.test(f.name)) {
      toast.error("Selecione um arquivo SVG.");
      return;
    }
    setFile(f);
  };

  const convert = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const blob = await rasterizeSvg(file, Number(scale), format);
      saveAs(blob, file.name.replace(/\.svg$/i, "") + `.${format === "jpeg" ? "jpg" : "png"}`);
      toast.success("Conversão concluída!");
    } catch (e) {
      toast.error("Falha na conversão", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Formato de saída</Label>
          <Select value={format} onValueChange={(v) => setFormat(v as "png" | "jpeg")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="png">PNG (transparente)</SelectItem>
              <SelectItem value="jpeg">JPG (fundo branco)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Escala / nitidez</Label>
          <Select value={scale} onValueChange={setScale}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1x (tamanho original)</SelectItem>
              <SelectItem value="2">2x (recomendado)</SelectItem>
              <SelectItem value="3">3x (alta resolução)</SelectItem>
              <SelectItem value="4">4x (máximo)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onPick(e.dataTransfer.files?.[0]); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-foreground font-heading mb-1">
          {file ? file.name : "Arraste seu SVG aqui"}
        </p>
        <p className="text-sm text-muted-foreground">Arquivo .svg</p>
        <input
          ref={inputRef}
          type="file"
          accept=".svg,image/svg+xml"
          onChange={(e) => onPick(e.target.files?.[0])}
          className="hidden"
        />
      </div>

      {file && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground truncate max-w-xs">{file.name}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setFile(null)}>Limpar</Button>
            <Button onClick={convert} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Converter para {format === "jpeg" ? "JPG" : "PNG"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SvgToImage;