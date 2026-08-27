import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import jsPDF from "jspdf";
import { useAdoptDroppedFile } from "./shared/dropped-file";

async function svgToCanvas(file: File, scale: number) {
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
  if (!width || !height) { width = 1024; height = 1024; }

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
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { canvas, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SvgToPdf = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pageSize, setPageSize] = useState<"a4" | "letter" | "fit">("fit");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
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

  useAdoptDroppedFile(onPick);

  const convert = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const { canvas, width, height } = await svgToCanvas(file, 3);
      const dataUrl = canvas.toDataURL("image/png");

      let pdf: jsPDF;
      if (pageSize === "fit") {
        const ratio = width / height;
        // Use mm — limit max dimension to ~600mm to keep PDF reasonable
        const maxMm = 600;
        let w = width;
        let h = height;
        const px2mm = 0.2645833333; // 1px = 0.2645mm at 96dpi
        w = w * px2mm; h = h * px2mm;
        if (w > maxMm || h > maxMm) {
          if (w >= h) { h = (maxMm / w) * h; w = maxMm; }
          else { w = (maxMm / h) * w; h = maxMm; }
        }
        pdf = new jsPDF({
          orientation: ratio >= 1 ? "landscape" : "portrait",
          unit: "mm",
          format: [w, h],
        });
        pdf.addImage(dataUrl, "PNG", 0, 0, w, h);
      } else {
        pdf = new jsPDF({ orientation, unit: "mm", format: pageSize });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const availW = pageW - margin * 2;
        const availH = pageH - margin * 2;
        const ratio = width / height;
        let drawW = availW;
        let drawH = drawW / ratio;
        if (drawH > availH) { drawH = availH; drawW = drawH * ratio; }
        const x = (pageW - drawW) / 2;
        const y = (pageH - drawH) / 2;
        pdf.addImage(dataUrl, "PNG", x, y, drawW, drawH);
      }

      const blob = pdf.output("blob");
      saveAs(blob, file.name.replace(/\.svg$/i, "") + ".pdf");
      toast.success("PDF gerado!");
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
          <Label className="text-muted-foreground">Tamanho da página</Label>
          <Select value={pageSize} onValueChange={(v) => setPageSize(v as typeof pageSize)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fit">Ajustar ao SVG (sem bordas)</SelectItem>
              <SelectItem value="a4">A4</SelectItem>
              <SelectItem value="letter">Carta (Letter)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Orientação</Label>
          <Select
            value={orientation}
            onValueChange={(v) => setOrientation(v as typeof orientation)}
            disabled={pageSize === "fit"}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="portrait">Retrato</SelectItem>
              <SelectItem value="landscape">Paisagem</SelectItem>
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
              Converter para PDF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SvgToPdf;