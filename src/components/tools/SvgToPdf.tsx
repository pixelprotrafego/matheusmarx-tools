import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Download, Loader2 } from "lucide-react";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { useAdoptDroppedFile } from "./shared/dropped-file";

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
      const { svgToPdf } = await import("@/lib/svg-to-pdf");
      const { blob, vector } = await svgToPdf(await file.text(), { pageSize, orientation });
      saveAs(blob, file.name.replace(/\.svg$/i, "") + ".pdf");
      toast.success(vector ? "PDF gerado, vetorial como o SVG!" : "PDF gerado (o SVG usa filtros ou HTML embutido, por isso foi como imagem em alta resolução).");
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