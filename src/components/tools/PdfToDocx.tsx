import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { useAdoptDroppedFile } from "./shared/dropped-file";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { downloadBlob } from "@/lib/download";

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
  const pdfPassword = usePdfPassword();
  const { catchPassword } = pdfPassword;

  const processFile = useCallback(async (selectedFile: File, password?: string) => {
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
        password,
        onProgress: (percent, message) => {
          setProgress(percent);
          setStatus(message);
        },
      });

      setResultBlob(blob);
      // Página sem texto é página escaneada: ela vai para o Word como a
      // imagem da própria página, sem texto editável por trás. É melhor dizer
      // isso do que deixar quem usa descobrir sozinho ao tentar editar.
      if (pagesWithoutText > 0) {
        setWarning(
          pagesWithoutText === pages
            ? "Este PDF é escaneado: as páginas foram para o Word como imagem, iguais ao original, mas o texto delas não é editável."
            : pagesWithoutText === 1
              ? "Uma página deste PDF é escaneada: ela foi para o Word como imagem, igual ao original, mas sem texto editável."
              : `${pagesWithoutText} páginas deste PDF são escaneadas: foram para o Word como imagem, iguais ao original, mas sem texto editável.`,
        );
      }
      toast.success(`Word gerado a partir de ${pages} página${pages > 1 ? "s" : ""}.`);
    } catch (err) {
      if (catchPassword(err)) return;
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
      setStatus("");
    }
  }, [catchPassword]);

  const startFile = useCallback((f: File) => {
    pdfPassword.reset();
    void processFile(f);
  }, [processFile, pdfPassword]);

  useAdoptDroppedFile(startFile);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") startFile(f);
  }, [startFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) startFile(f);
  };

  const downloadResult = () => {
    if (!resultBlob || !file) return;
    // file-saver espera o download começar antes de liberar a URL; revogar
    // logo depois do clique cancela o download em alguns navegadores.
    downloadBlob(resultBlob, file.name.replace(/\.[^.]+$/, "") + ".docx");
  };

  const reset = () => {
    setFile(null);
    setResultBlob(null);
    setProgress(0);
    setWarning(null);
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

          {pdfPassword.request && !loading && (
            <PdfPasswordPrompt
              reason={pdfPassword.request}
              onSubmit={(pw) => { pdfPassword.provide(pw); void processFile(file, pw); }}
            />
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
              <Button variant="outline" size="sm" onClick={() => file && processFile(file, pdfPassword.password)} className="gap-1 shrink-0">
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
