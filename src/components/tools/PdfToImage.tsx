import { useState, useCallback, useEffect, useRef } from "react";
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
import { useAdoptDroppedFile } from "./shared/dropped-file";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { openPdfjs } from "@/lib/pdf-unlock";

interface PageImage {
  /** URL de objeto do Blob, para a miniatura e o download. */
  url: string;
  blob: Blob;
  pageNumber: number;
  /** Extensão do arquivo como ele foi gerado, e não a da opção marcada agora. */
  ext: "png" | "jpg";
}

/** O PDF mede em pontos: 72 pt por polegada é a escala 1:1 do documento. */
const PDF_BASE_DPI = 72;

const DPI_OPTIONS = [
  { value: 150, label: "150 DPI", hint: "Leitura em tela" },
  { value: 300, label: "300 DPI", hint: "Impressão" },
  { value: 600, label: "600 DPI", hint: "Máxima — arquivos grandes" },
] as const;

const PdfToImage = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState([90]);
  const [dpi, setDpi] = useState<number>(150);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfPassword = usePdfPassword();
  const { catchPassword } = pdfPassword;

  // Imagens de página em alta resolução pesam dezenas de MB cada; a URL de
  // objeto antiga é liberada sempre que a lista é trocada.
  const replacePages = useCallback((next: PageImage[]) => {
    setPages((previous) => {
      for (const page of previous) URL.revokeObjectURL(page.url);
      return next;
    });
  }, []);

  // Ao sair da ferramenta, as imagens que ainda estão na tela são liberadas.
  const pagesRef = useRef<PageImage[]>([]);
  pagesRef.current = pages;
  useEffect(() => () => {
    for (const page of pagesRef.current) URL.revokeObjectURL(page.url);
  }, []);

  const processFile = useCallback(async (selectedFile: File, password?: string) => {
    const rl = guard("pdf-to-image", { hourly: 15, daily: 50 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true);
    setProgress(0);
    replacePages([]);
    setError(null);

    try {
      const { pdfjsLib } = await import("@/lib/pdfjs-setup");
      const pdf = await openPdfjs(await selectedFile.arrayBuffer(), password);
      const totalPages = pdf.numPages;
      const renderedPages: PageImage[] = [];
      const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
      const ext = format === "jpeg" ? "jpg" : "png";

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: dpi / PDF_BASE_DPI });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d")!;
        // Com os valores dos campos de formulário desenhados, como um leitor
        // de PDF mostra a página — e não com os campos em branco.
        await page.render({
          canvasContext: ctx,
          viewport,
          annotationMode: pdfjsLib.AnnotationMode.ENABLE_STORAGE,
        }).promise;

        const blob = await new Promise<Blob>((res, rej) =>
          canvas.toBlob(
            (b) => (b ? res(b) : rej(new Error(`Não foi possível gerar a imagem da página ${i}.`))),
            mimeType,
            quality[0] / 100,
          ));
        canvas.width = 0;
        canvas.height = 0;
        renderedPages.push({ url: URL.createObjectURL(blob), blob, pageNumber: i, ext });
        setProgress(Math.round((i / totalPages) * 100));
      }

      replacePages(renderedPages);
    } catch (err) {
      if (!catchPassword(err)) {
        setError("Erro ao processar o PDF. Verifique se o arquivo é válido e tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  }, [format, quality, dpi, replacePages, catchPassword]);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    replacePages([]);
    setError(null);
    setProgress(0);
    pdfPassword.reset();
  }, [replacePages, pdfPassword]);

  useAdoptDroppedFile(handleFileSelect);

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
    saveAs(page.blob, `pagina-${page.pageNumber}.${page.ext}`);
  };

  const downloadAll = async () => {
    if (pages.length === 0) return;
    const zip = new JSZip();
    for (const page of pages) zip.file(`pagina-${page.pageNumber}.${page.ext}`, page.blob);
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `pdf-imagens.zip`);
  };

  const reset = () => {
    setFile(null);
    replacePages([]);
    setProgress(0);
    setError(null);
    pdfPassword.reset();
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
              <label className="text-sm text-muted-foreground">Resolução</label>
              <div className="flex gap-2">
                {DPI_OPTIONS.map((d) => (
                  <Button
                    key={d.value}
                    variant={dpi === d.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setDpi(d.value)}
                    title={d.hint}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* A qualidade só existe em JPEG: toDataURL ignora o parâmetro em PNG,
              e o controle dava a impressão falsa de estar surtindo efeito. */}
          {format === "jpeg" && (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Qualidade: {quality[0]}%</label>
              <Slider value={quality} onValueChange={setQuality} min={10} max={100} step={5} />
            </div>
          )}

          {pdfPassword.request && (
            <PdfPasswordPrompt
              reason={pdfPassword.request}
              busy={loading}
              onSubmit={(pw) => { pdfPassword.provide(pw); void processFile(file, pw); }}
            />
          )}

          {/* Convert Button */}
          <Button
            onClick={() => processFile(file, pdfPassword.password)}
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
                          src={page.url}
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
