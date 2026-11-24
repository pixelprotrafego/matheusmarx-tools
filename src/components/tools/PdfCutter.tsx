import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, CheckSquare, Square } from "lucide-react";
import { saveAs } from "file-saver";
import ErrorState from "./shared/ErrorState";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { keepOpenPassword, loadPdfLib, openPdf, openPdfjs } from "@/lib/pdf-unlock";

interface PageThumb {
  dataUrl: string;
  pageNumber: number;
  selected: boolean;
}

const PdfCutter = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pages, setPages] = useState<PageThumb[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfPassword = usePdfPassword();
  const { catchPassword } = pdfPassword;

  const processFile = useCallback(async (selectedFile: File, password?: string) => {
    setFile(selectedFile);
    setLoading(true);
    setProgress(0);
    setPages([]);
    setError(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      setPdfBytes(arrayBuffer.slice(0));
      const pdf = await openPdfjs(arrayBuffer, password);
      const totalPages = pdf.numPages;
      const thumbs: PageThumb[] = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;

        thumbs.push({
          dataUrl: canvas.toDataURL("image/png"),
          pageNumber: i,
          selected: true,
        });
        setProgress(Math.round((i / totalPages) * 100));
      }

      setPages(thumbs);
    } catch (err) {
      if (!catchPassword(err)) setError(err instanceof Error ? err.message : "Não foi possível abrir este PDF.");
    } finally {
      setLoading(false);
    }
  }, [catchPassword]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.type === "application/pdf") { pdfPassword.reset(); processFile(droppedFile); }
  }, [processFile, pdfPassword]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { pdfPassword.reset(); processFile(f); }
  };

  const togglePage = (pageNumber: number) => {
    setPages((prev) =>
      prev.map((p) =>
        p.pageNumber === pageNumber ? { ...p, selected: !p.selected } : p
      )
    );
  };

  const selectAll = () => setPages((prev) => prev.map((p) => ({ ...p, selected: true })));
  const deselectAll = () => setPages((prev) => prev.map((p) => ({ ...p, selected: false })));

  const selectedCount = pages.filter((p) => p.selected).length;

  const generateCutPdf = async () => {
    if (!pdfBytes || selectedCount === 0) return;
    setGenerating(true);
    setError(null);

    try {
      const { PDFDocument } = await loadPdfLib();
      const opened = await openPdf(pdfBytes, pdfPassword.password);
      const newDoc = await PDFDocument.create();
      const selectedPages = pages.filter((p) => p.selected).map((p) => p.pageNumber - 1);
      const copiedPages = await newDoc.copyPages(opened.doc, selectedPages);

      for (const page of copiedPages) {
        newDoc.addPage(page);
      }

      keepOpenPassword({ ...opened, doc: newDoc });
      const pdfBytesOut = await newDoc.save();
      const blob = new Blob([pdfBytesOut.buffer as ArrayBuffer], { type: "application/pdf" });
      saveAs(blob, `pdf-cortado-${selectedCount}pgs.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o PDF.");
    } finally {
      setGenerating(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPdfBytes(null);
    setPages([]);
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
              <FileText className="w-5 h-5 text-primary" />
              <span className="text-foreground font-medium">{file.name}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={reset}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {pdfPassword.request && (
            <PdfPasswordPrompt
              reason={pdfPassword.request}
              busy={loading}
              onSubmit={(pw) => { pdfPassword.provide(pw); void processFile(file, pw); }}
            />
          )}

          {error && !loading && <ErrorState message={error} />}

          {loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Carregando páginas...</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {pages.length > 0 && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={selectAll} className="gap-1">
                    <CheckSquare className="w-3 h-3" /> Todas
                  </Button>
                  <Button variant="outline" size="sm" onClick={deselectAll} className="gap-1">
                    <Square className="w-3 h-3" /> Nenhuma
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {selectedCount} de {pages.length} selecionadas
                  </span>
                </div>
                <Button onClick={generateCutPdf} disabled={generating || selectedCount === 0} className="gap-2">
                  {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Gerar PDF ({selectedCount} pgs)
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {pages.map((page) => (
                  <Card
                    key={page.pageNumber}
                    className={`overflow-hidden cursor-pointer transition-all ${
                      page.selected
                        ? "border-primary ring-1 ring-primary/30 bg-card"
                        : "border-border bg-card opacity-50"
                    }`}
                    onClick={() => togglePage(page.pageNumber)}
                  >
                    <CardContent className="p-2">
                      <div className="relative">
                        <img
                          src={page.dataUrl}
                          alt={`Página ${page.pageNumber}`}
                          className="w-full h-auto rounded"
                        />
                        <div className="absolute top-2 left-2">
                          <Checkbox checked={page.selected} className="bg-background/80" />
                        </div>
                      </div>
                      <p className="text-xs text-center mt-2 text-muted-foreground">
                        Página {page.pageNumber}
                      </p>
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

export default PdfCutter;
