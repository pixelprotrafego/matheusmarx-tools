import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileSpreadsheet, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const XlsxToPdf = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    setLoading(true);
    setProgress(10);
    setResultUrl(null);
    setError(null);

    try {
      const XLSX = await import("xlsx");
      const arrayBuffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      setProgress(30);

      const { default: jsPDF } = await import("jspdf");
      const autoTableMod: any = await import("jspdf-autotable");
      const autoTable = autoTableMod.default ?? autoTableMod;

      const pdf = new jsPDF("l", "mm", "a4");
      let firstSheet = true;

      for (let s = 0; s < workbook.SheetNames.length; s++) {
        const name = workbook.SheetNames[s];
        const sheet = workbook.Sheets[name];
        const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          blankrows: false,
          defval: "",
          raw: false,
        });
        if (!rows.length) continue;

        if (!firstSheet) pdf.addPage();
        firstSheet = false;

        pdf.setFontSize(14);
        pdf.text(name, 14, 14);

        const head = [rows[0].map((c) => String(c ?? ""))];
        const body = rows.slice(1).map((r) => r.map((c) => String(c ?? "")));

        autoTable(pdf, {
          head,
          body,
          startY: 18,
          styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
          headStyles: { fillColor: [40, 40, 40], textColor: 255 },
          alternateRowStyles: { fillColor: [248, 248, 248] },
          margin: { left: 10, right: 10 },
        });

        setProgress(30 + Math.round(((s + 1) / workbook.SheetNames.length) * 60));
      }

      setProgress(100);
      const blob = pdf.output("blob");
      setResultUrl(URL.createObjectURL(blob));
      toast.success("Excel convertido para PDF (texto selecionável)!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const downloadResult = () => {
    if (!resultUrl || !file) return;
    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = file.name.replace(/\.[^.]+$/, "") + ".pdf";
    link.click();
  };

  const reset = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setFile(null);
    setResultUrl(null);
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
          <p className="text-lg font-heading text-foreground mb-2">Arraste seu arquivo Excel aqui</p>
          <p className="text-sm text-muted-foreground">XLSX ou XLS</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange} className="hidden" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
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
                <span className="text-sm text-muted-foreground">Convertendo Excel para PDF...</span>
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

          {resultUrl && (
            <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
              <FileSpreadsheet className="w-12 h-12 mx-auto text-primary" />
              <p className="text-foreground font-heading">Conversão concluída!</p>
              <Button onClick={downloadResult} className="gap-2">
                <Download className="w-4 h-4" />
                Baixar PDF
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default XlsxToPdf;
