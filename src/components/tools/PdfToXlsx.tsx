import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { useAdoptDroppedFile } from "./shared/dropped-file";
import PdfPasswordPrompt from "./shared/PdfPasswordPrompt";
import { usePdfPassword } from "./shared/use-pdf-password";
import { bytesToBlob } from "@/lib/download";

const PdfToXlsx = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [singleSheet, setSingleSheet] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pdfPassword = usePdfPassword();
  const { catchPassword } = pdfPassword;

  const processFile = useCallback(async (selectedFile: File, opts: { password?: string; single: boolean }) => {
    setFile(selectedFile);
    setLoading(true);
    setProgress(5);
    setStatus("Lendo o arquivo...");
    setResultBlob(null);
    setWarning(null);
    setError(null);

    try {
      // Tabelas viram células, e números viram números (moeda, porcentagem e
      // data com o formato certo), no navegador.
      const { pdfToXlsx } = await import("@/lib/pdf-to-xlsx");
      const { bytes, pages, pagesWithoutText } = await pdfToXlsx(await selectedFile.arrayBuffer(), {
        password: opts.password,
        singleSheet: opts.single,
        onProgress: (percent, message) => {
          setProgress(percent);
          setStatus(message);
        },
      });
      setResultBlob(bytesToBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
      if (pagesWithoutText > 0) {
        setWarning(
          pagesWithoutText === 1
            ? "Uma página deste PDF é digitalizada (imagem, sem texto) e ficou de fora da planilha."
            : `${pagesWithoutText} páginas deste PDF são digitalizadas (imagem, sem texto) e ficaram de fora da planilha.`,
        );
      }
      toast.success(`Planilha gerada a partir de ${pages} página${pages > 1 ? "s" : ""}.`);
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
    void processFile(f, { single: singleSheet });
  }, [processFile, pdfPassword, singleSheet]);

  useAdoptDroppedFile(startFile);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name))) startFile(f);
  }, [startFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) startFile(f);
  };

  const changeLayout = (single: boolean) => {
    setSingleSheet(single);
    if (file && !loading && !pdfPassword.request) void processFile(file, { password: pdfPassword.password, single });
  };

  const downloadResult = () => {
    if (!resultBlob || !file) return;
    saveAs(resultBlob, file.name.replace(/\.[^.]+$/, "") + ".xlsx");
  };

  const reset = () => {
    setFile(null);
    setResultBlob(null);
    setWarning(null);
    setProgress(0);
    setError(null);
    pdfPassword.reset();
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Switch id="pdf-xlsx-single" checked={singleSheet} onCheckedChange={changeLayout} disabled={loading} />
        <Label htmlFor="pdf-xlsx-single" className="cursor-pointer">
          Todas as páginas numa planilha só (em vez de uma aba por página)
        </Label>
      </div>

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
          <p className="text-sm text-muted-foreground">Extrai texto do PDF e gera uma planilha Excel (.xlsx)</p>
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
              onSubmit={(pw) => { pdfPassword.provide(pw); void processFile(file, { password: pw, single: singleSheet }); }}
            />
          )}

          {loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">{status || "Extraindo texto e gerando XLSX..."}</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {error && !loading && (
            <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg p-4">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p className="text-sm flex-1">{error}</p>
              <Button variant="outline" size="sm" onClick={() => processFile(file, { password: pdfPassword.password, single: singleSheet })} className="gap-1 shrink-0">
                <RotateCcw className="w-3 h-3" /> Tentar novamente
              </Button>
            </div>
          )}

          {resultBlob && (
            <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
              <FileText className="w-12 h-12 mx-auto text-primary" />
              <p className="text-foreground font-heading">Conversão concluída!</p>
              <p className="text-sm text-muted-foreground">
                {singleSheet ? "Todas as páginas estão numa planilha só." : "Cada página do PDF virou uma aba na planilha."}
              </p>
              {warning && <p className="text-sm text-muted-foreground">{warning}</p>}
              <Button onClick={downloadResult} className="gap-2">
                <Download className="w-4 h-4" />
                Baixar XLSX
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PdfToXlsx;
