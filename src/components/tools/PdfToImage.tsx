import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Upload, Download, FileImage, Loader2, X, RefreshCw } from "lucide-react";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { toast } from "sonner";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";

interface PageImage {
  dataUrl: string;
  pageNumber: number;
}

const PdfToImage = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState([90]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (selectedFile: File) => {
    const rl = guard("pdf-to-image", { hourly: 15, daily: 50 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true);
    setProgress(0);
    setPages([]);
    setError(null);

    try {
      const { pdfjsLib } = await import("@/lib/pdfjs-setup");
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;
      const renderedPages: PageImage[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;

        const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
        const dataUrl = canvas.toDataURL(mimeType, quality[0] / 100);
        renderedPages.push({ dataUrl, pageNumber: i });
        setProgress(Math.round((i / totalPages) * 100));
      }

      setPages(renderedPages);
    } catch (err) {
      console.error("Error processing PDF:", err);
      setError("Erro ao processar o PDF. Verifique se o arquivo é válido e tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [format, quality]);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    setPages([]);
    setError(null);
    setProgress(0);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") handleFileSelect(droppedFile);
  }, [handleFileSelect]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFileSelect(f);
  };

  const downloadPage = (page: PageImage) => {
    const ext = format === "jpeg" ? "jpg" : "png";
    const link = document.createElement("a");
    link.href = page.dataUrl;
    link.download = `pagina-${page.pageNumber}.${ext}`;
    link.click();
  };

  const downloadAll = async () => {
    if (pages.length === 0) return;
    const zip = new JSZip();
    const ext = format === "jpeg" ? "jpg" : "png";

    for (const page of pages) {
      const base64 = page.dataUrl.split(",")[1];
      zip.file(`pagina-${page.pageNumber}.${ext}`, base64, { base64: true });
    }

    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `pdf-imagens.zip`);
  };

  const reset = () => {
    setFile(null);
    setPages([]);
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      {!file ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-heading text-foreground mb-2">Arraste seu PDF aqui</p>
          <p className="text-sm text-muted-foreground">ou clique para selecionar</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileImage className="w-5 h-5 text-primary" />
              <span className="text-foreground font-medium">{file.name}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={reset}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Formato</label>
              <div className="flex gap-2">
                <Button
                  variant={format === "png" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormat("png")}
                >
                  PNG
                </Button>
                <Button
                  variant={format === "jpeg" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFormat("jpeg")}
                >
                  JPG
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Qualidade: {quality[0]}%</label>
              <Slider value={quality} onValueChange={setQuality} min={10} max={100} step={5} />
            </div>
          </div>

          {/* Convert Button */}
          <Button
            onClick={() => processFile(file)}
            disabled={loading}
            className="w-full gap-2"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processando...
              </>
            ) : pages.length > 0 ? (
              <>
                <RefreshCw className="w-4 h-4" />
                Reconverter
              </>
            ) : (
              <>
                <FileImage className="w-4 h-4" />
                Converter para {format === "png" ? "PNG" : "JPG"}
              </>
            )}
          </Button>

          {loading && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-xs text-muted-foreground text-center">{progress}%</p>
            </div>
          )}

          {error && (
            <div className="text-center text-destructive py-4 text-sm">
              {error}
            </div>
          )}

          {pages.length > 0 && (
            <>
              <div className="flex justify-end">
                <Button onClick={downloadAll} className="gap-2">
                  <Download className="w-4 h-4" />
                  Baixar todas ({pages.length}) em ZIP
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {pages.map((page) => (
                  <Card key={page.pageNumber} className="overflow-hidden group cursor-pointer bg-card border-border hover:border-primary/50 transition-colors" onClick={() => downloadPage(page)}>
                    <CardContent className="p-2">
                      <div className="relative">
                        <img
                          src={page.dataUrl}
                          alt={`Página ${page.pageNumber}`}
                          className="w-full h-auto rounded"
                        />
                        <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                          <Download className="w-6 h-6 text-primary" />
                        </div>
                      </div>
                      <p className="text-xs text-center mt-2 text-muted-foreground">Página {page.pageNumber}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfToImage;
