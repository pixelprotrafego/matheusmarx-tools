import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw, ImageIcon, Type } from "lucide-react";
import { toast } from "sonner";
import { docxToPdfText } from "@/lib/docx-to-pdf-text";

type Mode = "fiel" | "texto";

/** Um pixel de CSS vale 1/96 de polegada — a régua para converter px em mm. */
const CSS_DPI = 96;

const waitForAssets = async (host: HTMLElement) => {
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* noop */ }
  const imgs = Array.from(host.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
            setTimeout(resolve, 4000);
          }),
    ),
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
};

const DocxToPdf = () => {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("fiel");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Troca a URL do resultado revogando a anterior: sem isso cada nova conversão
  // deixa o PDF antigo preso na memória até a aba ser fechada.
  const replaceResultUrl = useCallback((url: string | null) => {
    setResultUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
  }, []);

  const convertFaithful = useCallback(async (arrayBuffer: ArrayBuffer): Promise<Blob> => {
    const host = document.createElement("div");
    host.className = "docx-render-host";
    document.body.appendChild(host);

    try {
      const { renderAsync } = await import("docx-preview");
      setProgress(20);
      setStatus("Renderizando o documento...");

      await renderAsync(arrayBuffer, host, undefined, {
        className: "docx",
        inWrapper: true,
        breakPages: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        ignoreWidth: false,
        ignoreHeight: false,
        experimental: true,
        useBase64URL: true,
        trimXmlDeclaration: true,
      });

      await waitForAssets(host);

      const pages = Array.from(host.querySelectorAll<HTMLElement>("section.docx"));
      if (!pages.length) throw new Error("Não foi possível renderizar as páginas deste documento.");
      if (pages.length > 60) {
        toast.warning(`Documento com ${pages.length} páginas — a conversão pode demorar.`);
      }

      const html2canvas = (await import("html2canvas")).default;
      const { default: jsPDF } = await import("jspdf");

      // Documentos longos rasterizados em alta escala estouram a memória da
      // aba, então a nitidez cede um pouco conforme a contagem de páginas.
      const scale = pages.length <= 20 ? 3 : pages.length <= 60 ? 2.5 : 2;

      let pdf: import("jspdf").jsPDF | null = null;

      for (let i = 0; i < pages.length; i++) {
        setStatus(`Convertendo página ${i + 1} de ${pages.length}...`);
        setProgress(20 + Math.round(((i + 1) / pages.length) * 70));

        const page = pages[i];

        // Tamanho real da página que o Word declarou, e não A4 presumido:
        // forçar A4 encolhe e centraliza documentos em Carta, ofício ou A5,
        // que era a causa do resultado "não bate com o original".
        const rect = page.getBoundingClientRect();
        const wMm = (rect.width * 25.4) / CSS_DPI;
        const hMm = (rect.height * 25.4) / CSS_DPI;

        const canvas = await html2canvas(page, {
          scale,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
        });

        const orientation = wMm > hMm ? "landscape" : "portrait";
        if (!pdf) {
          pdf = new jsPDF({ unit: "mm", format: [wMm, hMm], orientation, compress: true });
        } else {
          pdf.addPage([wMm, hMm], orientation);
        }

        // PNG, não JPEG: o JPEG comprime em blocos de 8x8 e cria halos ao redor
        // das letras, que é o que deixava o texto sujo. PNG é sem perdas, e o
        // deflate do próprio PDF dá conta do tamanho em página de texto.
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wMm, hMm, undefined, "SLOW");

        // libera memória
        canvas.width = 0;
        canvas.height = 0;
      }

      setProgress(95);
      return pdf!.output("blob");
    } finally {
      host.remove();
    }
  }, []);

  const runConversion = useCallback(async (selectedFile: File, selectedMode: Mode) => {
    setLoading(true);
    setProgress(10);
    setStatus("Lendo o arquivo...");
    replaceResultUrl(null);
    setError(null);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const blob = selectedMode === "fiel"
        ? await convertFaithful(arrayBuffer)
        : await docxToPdfText(arrayBuffer, setProgress);

      setProgress(100);
      replaceResultUrl(URL.createObjectURL(blob));
      toast.success(selectedMode === "fiel" ? "PDF gerado com o layout original!" : "DOCX convertido (texto selecionável)!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setError(msg);
      toast.error("Falha na conversão", { description: msg });
    } finally {
      setLoading(false);
      setStatus("");
    }
  }, [convertFaithful, replaceResultUrl]);

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
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const modes: { id: Mode; label: string; desc: string; icon: typeof ImageIcon }[] = [
    { id: "fiel", label: "Fiel ao original", desc: "Mantém imagens, marca d'água, fundo e layout", icon: ImageIcon },
    { id: "texto", label: "Texto selecionável", desc: "Só o texto, pesquisável e leve", icon: Type },
  ];

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
          <p className="text-sm text-muted-foreground">DOCX — conversão com layout, imagens e marca d'água</p>
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

          {!resultUrl && (
            <div className="grid gap-3 sm:grid-cols-2">
              {modes.map((m) => {
                const Icon = m.icon;
                const active = mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setMode(m.id)}
                    className={`text-left rounded-lg border p-4 transition-colors disabled:opacity-60 ${
                      active ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <span className="font-heading text-sm text-foreground">{m.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{m.desc}</p>
                  </button>
                );
              })}
            </div>
          )}

          {!resultUrl && !loading && (
            <Button onClick={() => runConversion(file, mode)} className="w-full gap-2">
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
              <Button variant="outline" size="sm" onClick={() => runConversion(file, mode)} className="gap-1 shrink-0">
                <RotateCcw className="w-3 h-3" /> Tentar novamente
              </Button>
            </div>
          )}

          {resultUrl && (
            <div className="bg-secondary/50 rounded-lg p-6 text-center space-y-4">
              <FileText className="w-12 h-12 mx-auto text-primary" />
              <p className="text-foreground font-heading">Conversão concluída!</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={downloadResult} className="gap-2">
                  <Download className="w-4 h-4" />
                  Baixar PDF
                </Button>
                <Button variant="outline" onClick={() => { replaceResultUrl(null); setProgress(0); }} className="gap-2">
                  <RotateCcw className="w-4 h-4" /> Converter em outro modo
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
