import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAdoptDroppedFile } from "./shared/dropped-file";

const DocxToPdf = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useAdoptDroppedFile(setFile);

  // Troca a URL do resultado revogando a anterior: sem isso cada nova conversão
  // deixa o PDF antigo preso na memória até a aba ser fechada.
  const replaceResultUrl = useCallback((url: string | null) => {
    setResultUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
  }, []);

  // O motor monta o documento com as regras do Word e grava um PDF vetorial:
  // texto de verdade (selecionável), nas fontes equivalentes às do Office, e a
  // paginação do próprio documento. Tudo no navegador.
  const convert = useCallback(async (arrayBuffer: ArrayBuffer): Promise<{ blob: Blob; pages: number }> => {
    const { docxToPdf } = await import("@/lib/docx-to-pdf");
    const { bytes, pages } = await docxToPdf(arrayBuffer, {
      onProgress: (fraction, message) => {
        setProgress(10 + Math.round(fraction * 85));
        setStatus(message);
      },
    });
    return { blob: new Blob([bytes], { type: "application/pdf" }), pages };
  }, []);

  const runConversion = useCallback(async (selectedFile: File) => {
    setLoading(true);
    setProgress(10);
    setStatus("Lendo o arquivo...");
    replaceResultUrl(null);
    setPageCount(0);
    setError(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const { blob, pages } = await convert(arrayBuffer);

      setProgress(100);
      setPageCount(pages);
      replaceResultUrl(URL.createObjectURL(blob));
      toast.success(`PDF gerado com ${pages} página${pages > 1 ? "s" : ""}, fiel ao original!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
      setStatus("");
    }
  }, [convert, replaceResultUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); replaceResultUrl(null); setError(null); }
  }, [replaceResultUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); replaceResultUrl(null); setError(null); }
  };

  const downloadResult = () => {
    if (!resultUrl || !file) return;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = file.name.replace(/\.[^.]+$/, "") + ".pdf";
    link.click();
  };

  const reset = () => {
    setFile(null);
    replaceResultUrl(null);
    setProgress(0);
    setPageCount(0);
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
          <p className="text-lg font-heading text-foreground mb-2">Arraste seu arquivo Word aqui</p>
          <p className="text-sm text-muted-foreground">DOCX — mantém páginas, layout, imagens e marca d'água</p>
          <input ref={inputRef} type="file" accept=".docx" onChange={handleFileChange} className="hidden" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-primary" />
              <span className="text-foreground font-medium truncate max-w-xs">{file.name}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={reset}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {!resultUrl && !loading && (
            <Button onClick={() => runConversion(file)} className="w-full gap-2">
              <FileText className="w-4 h-4" /> Converter para PDF
            </Button>
          )}

          {loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{status || "Convertendo..."}</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg p-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="text-sm flex-1">{error}</p>
              <Button variant="outline" size="sm" onClick={() => runConversion(file)} className="gap-1 shrink-0">
                <RotateCcw className="w-3 h-3" /> Tentar novamente
              </Button>
            </div>
          )}

          {resultUrl && (
            <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
              <FileText className="w-12 h-12 mx-auto text-primary" />
              <p className="text-foreground font-heading">
                Conversão concluída — {pageCount} página{pageCount > 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={downloadResult} className="gap-2">
                  <Download className="w-4 h-4" />
                  Baixar PDF
                </Button>
                <Button variant="outline" onClick={reset} className="gap-2">
                  <RotateCcw className="w-4 h-4" /> Converter outro arquivo
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DocxToPdf;
