import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAdoptDroppedFile } from "./shared/dropped-file";

const PdfToDocx = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setLoading(true);
    setProgress(2);
    setStatus("Lendo o arquivo...");
    setResultBlob(null);
    setWarning(null);
    setError(null);

    try {
      const { pdfToDocx } = await import("@/lib/pdf-to-docx");
      const arrayBuffer = await selectedFile.arrayBuffer();

      const { blob, pages, pagesWithoutText } = await pdfToDocx(arrayBuffer, {
        onProgress: (percent, message) => {
          setProgress(percent);
          setStatus(message);
        },
      });

      setResultBlob(blob);
      // Página sem texto é página que veio digitalizada dentro de um PDF que
      // tem texto no resto. O conteúdo dela não existe como texto em lugar
      // nenhum do arquivo, então é melhor dizer isso do que deixar quem usa
      // descobrir sozinho que faltou um pedaço.
      if (pagesWithoutText > 0) {
        setWarning(
          pagesWithoutText === 1
            ? "Uma página deste PDF é só imagem, sem texto por trás, e por isso ficou vazia no Word."
            : `${pagesWithoutText} páginas deste PDF são só imagem, sem texto por trás, e por isso ficaram vazias no Word.`,
        );
      }
      toast.success(`Word gerado a partir de ${pages} página${pages > 1 ? "s" : ""}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
      setStatus("");
    }
  }, []);

  useAdoptDroppedFile(processFile);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") processFile(f);
  }, [processFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const downloadResult = () => {
    if (!resultBlob || !file) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(resultBlob);
    link.download = file.name.replace(/\.[^.]+$/, "") + ".docx";
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const reset = () => {
    setFile(null);
    setResultBlob(null);
    setProgress(0);
    setWarning(null);
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
          <p className="text-sm text-muted-foreground">Extrai texto do PDF e gera um arquivo Word (.docx)</p>
          <input ref={inputRef} type="file" accept=".pdf" onChange={handleFileChange} className="hidden" />
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
              <Button variant="outline" size="sm" onClick={() => file && processFile(file)} className="gap-1 shrink-0">
                <RotateCcw className="w-3 h-3" /> Tentar novamente
              </Button>
            </div>
          )}

          {warning && !loading && (
            <div className="flex items-center gap-3 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg p-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="text-sm flex-1">{warning}</p>
            </div>
          )}

          {resultBlob && (
            <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
              <FileText className="w-12 h-12 mx-auto text-primary" />
              <p className="text-foreground font-heading">Conversão concluída!</p>
              <p className="text-sm text-muted-foreground">Texto extraído do PDF e formatado como documento Word.</p>
              <Button onClick={downloadResult} className="gap-2">
                <Download className="w-4 h-4" />
                Baixar DOCX
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfToDocx;
