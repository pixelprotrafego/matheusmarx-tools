import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, FileText, Trash2, ArrowUp, ArrowDown, Lock, LockOpen, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { formatReset } from "@/lib/rate-limit";
import { guard, guardMessage } from "@/lib/abuse-guard";
import { BATCH_LIMITS, checkBatch } from "@/lib/validate-file";
import { loadPdfLib, openPdf, PdfPasswordError } from "@/lib/pdf-unlock";

/**
 * checking: sendo aberto para conferência
 * ok: abre normalmente
 * unlocked: era protegido e foi descriptografado
 * needs-password / wrong-password: tem senha de abertura
 * invalid: não abre (corrompido, não é PDF...)
 */
type Status = "checking" | "ok" | "unlocked" | "needs-password" | "wrong-password" | "invalid";

interface Entry {
  id: number;
  file: File;
  status: Status;
  password?: string;
  error?: string;
}

let nextId = 0;

const statusFromError = (err: unknown): Pick<Entry, "status" | "error"> => {
  if (err instanceof PdfPasswordError) {
    return { status: err.reason === "required" ? "needs-password" : "wrong-password" };
  }
  return { status: "invalid", error: err instanceof Error ? err.message : "Erro desconhecido" };
};

const PdfMerger = () => {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const patch = useCallback((id: number, changes: Partial<Entry>) => {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, ...changes } : e)));
  }, []);

  /** Abre o arquivo para saber, antes de unir, se ele vai dar problema. */
  const check = useCallback(async (id: number, file: File, password?: string) => {
    patch(id, { status: "checking", error: undefined });
    try {
      const { encrypted } = await openPdf(await file.arrayBuffer(), password);
      patch(id, { status: encrypted ? "unlocked" : "ok", password });
    } catch (err) {
      patch(id, statusFromError(err));
    }
  }, [patch]);

  const addFiles = useCallback(async (newFiles: FileList | File[]) => {
    const pdfFiles = Array.from(newFiles).filter(f => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast.error("Selecione apenas arquivos PDF");
      return;
    }
    const added: Entry[] = pdfFiles.map(file => ({ id: nextId++, file, status: "checking" }));
    setEntries(prev => [...prev, ...added]);
    // Um de cada vez, para não abrir vários PDFs grandes na memória ao mesmo tempo.
    for (const e of added) await check(e.id, e.file);
  }, [check]);

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
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    setEntries(prev => {
      const arr = [...prev];
      const target = index + direction;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  };

  const unlock = (entry: Entry) => {
    const password = drafts[entry.id];
    if (!password) return;
    check(entry.id, entry.file, password);
  };

  const blocked = entries.filter(e => e.status !== "ok" && e.status !== "unlocked");
  const checking = entries.some(e => e.status === "checking");

  const mergePdfs = async () => {
    if (entries.length < 2) {
      toast.error("Adicione pelo menos 2 PDFs");
      return;
    }
    if (blocked.length > 0) {
      toast.error("Há arquivos que não podem ser unidos", { description: blocked.map(e => e.file.name).join(", ") });
      return;
    }
    const batchErr = checkBatch(entries.length, BATCH_LIMITS.pdfsPerMerge, "PDFs");
    if (batchErr) { toast.error(batchErr); return; }
    const rl = guard("pdf-merge", { hourly: 20, daily: 80 });
    if (!rl.ok) {
      toast.error(guardMessage(rl), rl.reason === "bot" ? undefined : { description: `Tente novamente em ${formatReset(rl.resetInMs)}.` });
      return;
    }
    setLoading(true);
    setProgress(0);

    let current: Entry | undefined;
    try {
      const { PDFDocument } = await loadPdfLib();
      const mergedPdf = await PDFDocument.create();

      for (let i = 0; i < entries.length; i++) {
        current = entries[i];
        const { doc } = await openPdf(await current.file.arrayBuffer(), current.password);
        const pages = await mergedPdf.copyPages(doc, doc.getPageIndices());
        for (const page of pages) {
          mergedPdf.addPage(page);
        }
        setProgress(Math.round(((i + 1) / entries.length) * 90));
      }
      current = undefined;

      const pdfBytes = await mergedPdf.save();
      setProgress(100);
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      saveAs(blob, "pdf-unido.pdf");
      toast.success(`${entries.length} PDFs unidos com sucesso!`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      if (current) {
        patch(current.id, statusFromError(err));
        toast.error(`Falha ao unir: problema em "${current.file.name}"`, { description: msg });
      } else {
        toast.error("Falha ao unir PDFs", { description: msg });
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setEntries([]);
    setDrafts({});
    setProgress(0);
  };

  const renderStatus = (entry: Entry) => {
    switch (entry.status) {
      case "checking":
        return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" aria-label="Verificando" />;
      case "unlocked":
        return (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400" title="O arquivo tinha proteção e foi desbloqueado aqui no navegador">
            <LockOpen className="w-3 h-3" /> desbloqueado
          </span>
        );
      case "needs-password":
      case "wrong-password":
        return (
          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <Lock className="w-3 h-3" /> {entry.status === "needs-password" ? "pede senha" : "senha incorreta"}
          </span>
        );
      case "invalid":
        return (
          <span className="flex items-center gap-1 text-xs text-destructive" title={entry.error}>
            <AlertCircle className="w-3 h-3" /> não abre
          </span>
        );
      default:
        return null;
    }
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

      {entries.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{entries.length} arquivo(s) selecionado(s)</span>
            <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground">
              Limpar tudo
            </Button>
          </div>

          <div className="space-y-2">
            {entries.map((entry, index) => {
              const { file } = entry;
              const askPassword = entry.status === "needs-password" || entry.status === "wrong-password";
              return (
                <div
                  key={entry.id}
                  className={`p-3 rounded-lg border space-y-2 ${
                    askPassword ? "bg-amber-500/5 border-amber-500/40"
                      : entry.status === "invalid" ? "bg-destructive/5 border-destructive/40"
                      : "bg-secondary/30 border-border"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm text-foreground truncate flex-1">{file.name}</span>
                    <span className="shrink-0">{renderStatus(entry)}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveFile(index, -1)} disabled={index === 0} aria-label={`Mover ${file.name} para cima`}>
                        <ArrowUp className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveFile(index, 1)} disabled={index === entries.length - 1} aria-label={`Mover ${file.name} para baixo`}>
                        <ArrowDown className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFile(index)} aria-label={`Remover ${file.name}`}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {askPassword && (
                    <form
                      className="flex items-center gap-2 pl-7"
                      onSubmit={(e) => { e.preventDefault(); unlock(entry); }}
                    >
                      <Input
                        type="password"
                        autoComplete="off"
                        placeholder="Senha para abrir este PDF"
                        value={drafts[entry.id] ?? ""}
                        onChange={(e) => setDrafts(prev => ({ ...prev, [entry.id]: e.target.value }))}
                        className="h-8 text-sm"
                        aria-label={`Senha de ${file.name}`}
                      />
                      <Button type="submit" size="sm" variant="secondary" className="h-8 shrink-0" disabled={!drafts[entry.id]}>
                        Desbloquear
                      </Button>
                    </form>
                  )}

                  {entry.status === "invalid" && (
                    <p className="text-xs text-destructive pl-7 break-words">
                      Este arquivo não pôde ser aberto: {entry.error}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {blocked.length > 0 && !checking && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {blocked.length === 1 ? "1 arquivo precisa" : `${blocked.length} arquivos precisam`} de atenção antes de unir (veja os marcados acima).
            </p>
          )}

          {loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Unindo PDFs...</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          <Button onClick={mergePdfs} disabled={loading || entries.length < 2 || blocked.length > 0} className="w-full gap-2">
            {loading || checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {checking ? "Verificando arquivos..." : `Unir ${entries.length} PDFs`}
          </Button>
        </div>
      )}
    </div>
  );
};

export default PdfMerger;
