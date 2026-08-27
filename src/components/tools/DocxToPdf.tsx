import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Download, Loader2, X, FileText, AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { planSlices, type Block } from "@/lib/docx-pagination";
import { hasMsoPosition, isFullBleed, parseMsoPosition, resolveMsoOffset } from "@/lib/docx-vml-position";
import { useAdoptDroppedFile } from "./shared/dropped-file";

/** Um pixel de CSS vale 1/96 de polegada — a régua para converter px em mm. */
const CSS_DPI = 96;

const pxToMm = (px: number) => (px * 25.4) / CSS_DPI;

/** Uma página do PDF: um recorte vertical de uma seção renderizada. */
interface PageTile {
  section: HTMLElement;
  /** Deslocamento do topo do recorte dentro da seção, em px. */
  top: number;
  /** Altura do recorte, em px. */
  height: number;
  /** Altura da página do PDF, em px — igual para todas as fatias de uma seção. */
  pageHeight: number;
  width: number;
}

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

/**
 * Altura de página que o Word declarou para esta seção, em px.
 * O docx-preview grava isso em `min-height` a partir do `sectPr` do documento.
 */
const declaredPageHeight = (section: HTMLElement): number => {
  const raw = parseFloat(getComputedStyle(section).minHeight);
  return Number.isFinite(raw) && raw > 0 ? raw : section.getBoundingClientRect().height;
};

/**
 * Recoloca as formas VML de fundo desta seção.
 *
 * Modelos corporativos desenham o fundo da página com uma forma maior que a
 * folha, centralizada, para sangrar pelas bordas. O `docx-preview` copia o
 * estilo do VML literalmente para um `<svg>`, e o navegador descarta as
 * propriedades `mso-position-*` que fazem esse alinhamento — a forma ia parar
 * na origem da caixa de conteúdo, deslocada pelas margens, e o `overflow:hidden`
 * cortava o resto, deixando uma faixa da página sem fundo nenhum.
 */
const fixVmlBackgrounds = (section: HTMLElement) => {
  const rect = section.getBoundingClientRect();
  const estilo = getComputedStyle(section);
  const padLeft = parseFloat(estilo.paddingLeft) || 0;
  const padRight = parseFloat(estilo.paddingRight) || 0;
  const padTop = parseFloat(estilo.paddingTop) || 0;
  const padBottom = parseFloat(estilo.paddingBottom) || 0;

  const page = { width: rect.width, height: rect.height };
  const content = {
    left: padLeft,
    top: padTop,
    width: rect.width - padLeft - padRight,
    height: rect.height - padTop - padBottom,
  };

  for (const svg of Array.from(section.querySelectorAll<SVGElement>("svg[style]"))) {
    const styleText = svg.getAttribute("style") ?? "";
    if (!hasMsoPosition(styleText)) continue;

    const shapeRect = svg.getBoundingClientRect();
    const shape = { width: shapeRect.width, height: shapeRect.height };
    if (!(shape.width > 0 && shape.height > 0)) continue;

    const mso = parseMsoPosition(styleText);

    // Fundo de página sangrado se ancora na folha, não na área de texto —
    // mesmo quando o Word declarou a referência como "margin" ou "column".
    const sangrado = isFullBleed(shape, page);
    const { left, top } = resolveMsoOffset({
      mso: sangrado
        ? { ...mso, horizontalRelative: "page", verticalRelative: "page" }
        : mso,
      shape,
      page,
      content,
    });

    // O elemento é `position:absolute` dentro da seção, cuja caixa de
    // referência começa depois do padding: por isso o desconto aqui.
    if (left !== null) {
      svg.style.left = `${left - padLeft}px`;
      svg.style.marginLeft = "0";
    }
    if (top !== null) {
      svg.style.top = `${top - padTop}px`;
      svg.style.marginTop = "0";
    }
  }
};

/**
 * Blocos de conteúdo da seção, com o topo relativo ao topo da própria seção.
 * Servem de candidatos a ponto de corte, para uma fatia nunca partir um
 * parágrafo no meio da linha.
 */
const contentBlocks = (section: HTMLElement): Block[] => {
  const sectionTop = section.getBoundingClientRect().top;
  const nodes = section.querySelectorAll<HTMLElement>("article > *");
  return Array.from(nodes).map((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top - sectionTop, bottom: r.bottom - sectionTop };
  });
};

/**
 * Monta a lista de páginas do PDF a partir das seções renderizadas.
 *
 * Quando o arquivo foi salvo pelo Word, cada seção já é exatamente uma página e
 * nada é fatiado. Quando o arquivo veio de outro editor e não traz as marcas de
 * página, a seção cresce além da altura declarada e é dividida aqui.
 */
const planPages = (sections: HTMLElement[]): PageTile[] => {
  const tiles: PageTile[] = [];

  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    const pageHeight = declaredPageHeight(section);
    const slices = planSlices(contentBlocks(section), rect.height, pageHeight);

    for (const slice of slices) {
      tiles.push({
        section,
        top: slice.top,
        height: slice.height,
        // Fatia só existe quando houve transbordo; nesse caso todas as páginas
        // saem com a altura declarada pelo Word, para o PDF ficar uniforme.
        pageHeight: slices.length > 1 ? pageHeight : rect.height,
        width: rect.width,
      });
    }
  }

  return tiles;
};

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

  const convert = useCallback(async (arrayBuffer: ArrayBuffer): Promise<{ blob: Blob; pages: number }> => {
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
        // O Word grava em cada arquivo onde ele próprio quebrou as páginas
        // (`w:lastRenderedPageBreak`). O docx-preview ignora essas marcas por
        // padrão, e era por isso que o documento inteiro virava uma única
        // seção — e, no fim, um PDF de página só.
        ignoreLastRenderedPageBreak: false,
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

      const sections = Array.from(host.querySelectorAll<HTMLElement>("section.docx"));
      if (!sections.length) throw new Error("Não foi possível renderizar as páginas deste documento.");

      // Antes de medir e rasterizar: o docx-preview posiciona as formas VML
      // pelo estilo cru do Word, que o navegador não entende inteiro.
      for (const section of sections) fixVmlBackgrounds(section);
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      const tiles = planPages(sections);
      if (tiles.length > 60) {
        toast.warning(`Documento com ${tiles.length} páginas — a conversão pode demorar.`);
      }

      const html2canvas = (await import("html2canvas")).default;
      const { default: jsPDF } = await import("jspdf");

      // Documentos longos rasterizados em alta escala estouram a memória da
      // aba, então a nitidez cede um pouco conforme a contagem de páginas.
      const scale = tiles.length <= 20 ? 3 : tiles.length <= 60 ? 2.5 : 2;

      // O host fica fora da tela e pode ser mais alto que a janela; sem isso o
      // clone interno do html2canvas corta o que passa da dobra.
      const hostRect = host.getBoundingClientRect();
      const windowWidth = Math.max(window.innerWidth, Math.ceil(hostRect.width) + 32);
      const windowHeight = Math.max(window.innerHeight, Math.ceil(hostRect.height) + 32);

      let pdf: import("jspdf").jsPDF | null = null;

      for (let i = 0; i < tiles.length; i++) {
        setStatus(`Convertendo página ${i + 1} de ${tiles.length}...`);
        setProgress(20 + Math.round(((i + 1) / tiles.length) * 70));

        const tile = tiles[i];

        // Tamanho real da página que o Word declarou, e não A4 presumido:
        // forçar A4 encolhe e centraliza documentos em Carta, ofício ou A5,
        // que era a causa do resultado "não bate com o original".
        const wMm = pxToMm(tile.width);
        const hMm = pxToMm(tile.pageHeight);
        const drawnHMm = pxToMm(tile.height);

        // x/y do html2canvas são relativos ao próprio elemento, então cada
        // fatia é rasterizada sozinha — o canvas nunca fica mais alto que uma
        // página, mesmo num documento de centenas de páginas.
        const canvas = await html2canvas(tile.section, {
          scale,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
          x: 0,
          y: tile.top,
          width: tile.width,
          height: tile.height,
          windowWidth,
          windowHeight,
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
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, wMm, drawnHMm, undefined, "SLOW");

        // libera memória
        canvas.width = 0;
        canvas.height = 0;
      }

      setProgress(95);
      return { blob: pdf!.output("blob"), pages: tiles.length };
    } finally {
      host.remove();
    }
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
