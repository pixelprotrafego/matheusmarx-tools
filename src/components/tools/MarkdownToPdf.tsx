import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

const MarkdownToPdf = () => {
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
    setProgress(5);
    setResultUrl(null);
    setError(null);

    try {
      const text = await selectedFile.text();
      setProgress(20);
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF("p", "mm", "a4");

      // Layout
      const PAGE_W = 210, PAGE_H = 297;
      const MARGIN = 20;
      const CONTENT_W = PAGE_W - MARGIN * 2;
      let y = MARGIN;

      const ensureSpace = (h: number) => {
        if (y + h > PAGE_H - MARGIN) { pdf.addPage(); y = MARGIN; }
      };

      const writeLines = (text: string, opts: { size: number; bold?: boolean; gap?: number; color?: [number, number, number] }) => {
        pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
        pdf.setFontSize(opts.size);
        if (opts.color) pdf.setTextColor(...opts.color); else pdf.setTextColor(34, 34, 34);
        const lh = opts.size * 0.45;
        const lines = pdf.splitTextToSize(text, CONTENT_W);
        for (const line of lines) {
          ensureSpace(lh);
          pdf.text(line, MARGIN, y);
          y += lh;
        }
        y += opts.gap ?? 2;
      };

      const drawHr = () => { ensureSpace(4); pdf.setDrawColor(200); pdf.line(MARGIN, y, PAGE_W - MARGIN, y); y += 4; };

      // Mini parser linha-a-linha (texto selecionável real)
      const blocks = text.split(/\r?\n/);
      let inCode = false;
      let codeBuf: string[] = [];
      let listCounter = 0;

      const flushCode = () => {
        if (!codeBuf.length) return;
        const blockText = codeBuf.join("\n");
        const lines = pdf.splitTextToSize(blockText, CONTENT_W - 6);
        const lh = 4.2;
        const h = lines.length * lh + 4;
        ensureSpace(h);
        pdf.setFillColor(245, 245, 245);
        pdf.rect(MARGIN, y - 3, CONTENT_W, h, "F");
        pdf.setFont("courier", "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(40, 40, 40);
        let yy = y;
        for (const l of lines) { pdf.text(l, MARGIN + 3, yy); yy += lh; }
        y += h + 1;
        codeBuf = [];
      };

      for (let i = 0; i < blocks.length; i++) {
        const raw = blocks[i];
        if (/^```/.test(raw)) {
          if (inCode) { flushCode(); inCode = false; }
          else inCode = true;
          continue;
        }
        if (inCode) { codeBuf.push(raw); continue; }

        const line = raw.replace(/\s+$/, "");
        if (!line.trim()) { listCounter = 0; y += 2; continue; }

        // Headings
        const m = /^(#{1,6})\s+(.*)$/.exec(line);
        if (m) {
          const lvl = m[1].length;
          const sizes = [22, 18, 15, 13, 12, 11];
          writeLines(m[2], { size: sizes[lvl - 1], bold: true, gap: 3 });
          continue;
        }
        // HR
        if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) { drawHr(); continue; }
        // Blockquote
        if (/^>\s?/.test(line)) {
          const txt = line.replace(/^>\s?/, "");
          ensureSpace(6);
          pdf.setDrawColor(180); pdf.setLineWidth(0.8);
          pdf.line(MARGIN, y - 3, MARGIN, y + 3);
          pdf.setLineWidth(0.2);
          writeLines("  " + txt, { size: 11, color: [90, 90, 90], gap: 2 });
          continue;
        }
        // Unordered list
        const um = /^\s*[-*+]\s+(.*)$/.exec(line);
        if (um) { writeLines("• " + stripMd(um[1]), { size: 11, gap: 1 }); continue; }
        // Ordered list. O Markdown renumera a lista a partir do primeiro item:
        // "1. / 1. / 1." vira 1, 2, 3 — só o número de abertura é respeitado.
        const om = /^\s*(\d+)\.\s+(.*)$/.exec(line);
        if (om) {
          listCounter = listCounter === 0 ? parseInt(om[1], 10) : listCounter + 1;
          writeLines(`${listCounter}. ${stripMd(om[2])}`, { size: 11, gap: 1 });
          continue;
        }
        // Parágrafo
        writeLines(stripMd(line), { size: 11, gap: 2 });

        if (i % 30 === 0) setProgress(20 + Math.round((i / blocks.length) * 70));
      }
      if (inCode) flushCode();

      setProgress(100);
      const blob = pdf.output("blob");
      setResultUrl(URL.createObjectURL(blob));
      toast.success("Markdown convertido para PDF (texto selecionável)!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  // remove formatação inline mantendo texto puro
  function stripMd(s: string): string {
    return s
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/__(.+?)__/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/_(.+?)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
  }

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
          <p className="text-lg font-heading text-foreground mb-2">Arraste seu arquivo Markdown aqui</p>
          <p className="text-sm text-muted-foreground">.md</p>
          <input ref={inputRef} type="file" accept=".md,.markdown,.txt" onChange={handleFileChange} className="hidden" />
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
                <span className="text-sm text-muted-foreground">Convertendo Markdown para PDF...</span>
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
              <FileText className="w-12 h-12 mx-auto text-primary" />
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

export default MarkdownToPdf;
