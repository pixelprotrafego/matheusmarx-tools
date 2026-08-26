import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { PDFDocument } from "pdf-lib";
import { saveAs } from "file-saver";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";

const PdfMerger = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const pdfFiles = Array.from(newFiles).filter(f => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast.error("Selecione apenas arquivos PDF");
      return;
    }
    setFiles(prev => [...prev, ...pdfFiles]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setFiles(prev => {
      const arr = [...prev];
      const target = index + direction;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };

  const mergePdfs = async () => {
    if (files.length < 2) {
      toast.error("Adicione pelo menos 2 PDFs");
      return;
    }
    const batchErr = checkBatch(files.length, BATCH_LIMITS.pdfsPerMerge, "PDFs");
    if (batchErr) { toast.error(batchErr); return; }
    const rl = guard("pdf-merge", { hourly: 20, daily: 80 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true);
    setProgress(0);

    try {
      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < files.length; i++) {
        const arrayBuffer = await files[i].arrayBuffer();
        const pdf = await PDFDocument.load(arrayBuffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        for (const page of pages) {
          mergedPdf.addPage(page);
        }
        setProgress(Math.round(((i + 1) / files.length) * 90));
      }

      const pdfBytes = await mergedPdf.save();
      setProgress(100);
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      saveAs(blob, "pdf-unido.pdf");
      toast.success(`${files.length} PDFs unidos com sucesso!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error("Falha ao unir PDFs", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFiles([]);
    setProgress(0);
  };

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
          dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
        }`}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-foreground font-heading mb-1">Arraste seus PDFs aqui</p>
        <p className="text-sm text-muted-foreground">ou clique para selecionar múltiplos arquivos</p>
        <input ref={inputRef} type="file" accept=".pdf" multiple onChange={handleFileChange} className="hidden" />
      </div>

      {files.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{files.length} arquivo(s) selecionado(s)</span>
            <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
              Limpar tudo
            </Button>
          </div>

          <div className="space-y-2">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border"
              >
                <FileText className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm text-foreground truncate flex-1">{file.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveFile(index, -1)} disabled={index === 0} aria-label={`Mover ${file.name} para cima`}>
                    <ArrowUp className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1} aria-label={`Mover ${file.name} para baixo`}>
                    <ArrowDown className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFile(index)} aria-label={`Remover ${file.name}`}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Unindo PDFs...</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          <Button onClick={mergePdfs} disabled={loading || files.length < 2} className="w-full gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Unir {files.length} PDFs
          </Button>
        </div>
      )}
    </div>
  );
};

export default PdfMerger;
