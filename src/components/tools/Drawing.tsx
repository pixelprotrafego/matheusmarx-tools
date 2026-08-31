import { useEffect, useRef, useState, useCallback } from "react";
import * as fabric from "fabric";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Pencil, Brush, Eraser, MousePointer2, Square, Circle as CircleIcon, Triangle as TriangleIcon,
  Minus, Star, Type, Undo2, Redo2, Trash2, Download, ImagePlus, Maximize2, Minimize2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toPng, toJpg, toSvg, toJson } from "@/lib/drawing-export";
import { useExpanded } from "@/hooks/use-expanded";

type Tool = "select" | "pencil" | "brush" | "eraser";

/** Formas que nascem do arrasto: quem desenha decide o tamanho na hora. */
type ShapeKind = "rect" | "ellipse" | "triangle" | "line" | "star";

const SIZE_PRESETS = [
  { label: "1080 × 1080", w: 1080, h: 1080 },
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "800 × 600", w: 800, h: 600 },
  { label: "A4 retrato", w: 794, h: 1123 },
  { label: "A4 paisagem", w: 1123, h: 794 },
];

const MAX_OBJECTS = 1000;

/** Tamanho que a forma recebe num clique sem arrasto, para não virar um ponto. */
const TAMANHO_PADRAO = { w: 150, h: 110 };

/** Estrela de cinco pontas desenhada dentro de uma caixa de 100 x 100. */
const STAR_POINTS = (() => {
  const pts: { x: number; y: number }[] = [];
  const raioExterno = 50, raioInterno = 21, pontas = 5;
  for (let i = 0; i < pontas * 2; i++) {
    const r = i % 2 === 0 ? raioExterno : raioInterno;
    const a = (Math.PI / pontas) * i - Math.PI / 2;
    pts.push({ x: r * Math.cos(a) + raioExterno, y: r * Math.sin(a) + raioExterno });
  }
  return pts;
})();

/** Cria a forma sem tamanho, no ponto onde o arrasto começou. */
const createShape = (kind: ShapeKind, x: number, y: number, stroke: string, strokeWidth: number): fabric.Object => {
  const comum = {
    left: x, top: y, fill: "transparent", stroke, strokeWidth,
    originX: "left" as const, originY: "top" as const,
  };
  if (kind === "rect") return new fabric.Rect({ ...comum, width: 1, height: 1 });
  if (kind === "ellipse") return new fabric.Ellipse({ ...comum, rx: 1, ry: 1 });
  if (kind === "triangle") return new fabric.Triangle({ ...comum, width: 1, height: 1 });
  if (kind === "line") return new fabric.Line([x, y, x, y], { stroke, strokeWidth });
  return new fabric.Polygon(STAR_POINTS, { ...comum, scaleX: 0.01, scaleY: 0.01 });
};

/** Ajusta a forma ao ponteiro. Funciona em qualquer direção do arrasto. */
const resizeShape = (obj: fabric.Object, kind: ShapeKind, x0: number, y0: number, x: number, y: number) => {
  if (kind === "line") {
    (obj as fabric.Line).set({ x2: x, y2: y });
    obj.setCoords();
    return;
  }
  const left = Math.min(x0, x);
  const top = Math.min(y0, y);
  const largura = Math.max(1, Math.abs(x - x0));
  const altura = Math.max(1, Math.abs(y - y0));
  if (kind === "ellipse") (obj as fabric.Ellipse).set({ left, top, rx: largura / 2, ry: altura / 2 });
  else if (kind === "star") obj.set({ left, top, scaleX: largura / 100, scaleY: altura / 100 });
  else obj.set({ left, top, width: largura, height: altura });
  obj.setCoords();
};

const TBtn = ({ active, onClick, label, children, disabled }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean; }) => (
  <Button type="button" size="sm" variant={active ? "default" : "ghost"} onClick={onClick} aria-label={label} title={label} disabled={disabled} className="h-8 w-8 p-0">
    {children}
  </Button>
);

const Drawing = () => {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const skipSave = useRef(false);

  const [tool, setTool] = useState<Tool>("brush");
  const [shapeTool, setShapeTool] = useState<ShapeKind | null>(null);
  const [color, setColor] = useState("#e0bf3a");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [size, setSize] = useState(8);
  const [preset, setPreset] = useState(SIZE_PRESETS[0].label);
  const { expanded, toggle } = useExpanded();

  // O canvas do fabric é criado uma vez e sobrevive a re-renders, então os
  // manipuladores de mouse ficam presos ao valor que existia na criação. Estas
  // referências dão a eles o valor atual sem precisar reinstalar o canvas a
  // cada troca de cor ou de espessura.
  const shapeToolRef = useRef<ShapeKind | null>(null);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const dragRef = useRef<{ obj: fabric.Object; kind: ShapeKind; x0: number; y0: number } | null>(null);

  useEffect(() => { shapeToolRef.current = shapeTool; }, [shapeTool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);

  const saveState = useCallback(() => {
    if (!canvasRef.current || skipSave.current) return;
    const json = JSON.stringify(canvasRef.current.toJSON());
    undoStack.current.push(json);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  // Init canvas
  useEffect(() => {
    if (!canvasElRef.current) return;
    const p = SIZE_PRESETS.find(s => s.label === preset)!;
    const c = new fabric.Canvas(canvasElRef.current, {
      width: p.w,
      height: p.h,
      backgroundColor: bgColor,
      isDrawingMode: true,
    });
    canvasRef.current = c;
    saveState();
    c.on("object:added", saveState);
    c.on("object:modified", saveState);
    c.on("path:created", saveState);

    // ---- desenho de forma por arrasto ----
    //
    // A forma entra no canvas já no mouse:down, com tamanho 1, e cresce a cada
    // mouse:move. O histórico fica suspenso durante o arrasto (`skipSave`),
    // senão o desfazer voltaria para a forma de tamanho zero em vez de para
    // antes dela existir.
    c.on("mouse:down", (opt) => {
      const kind = shapeToolRef.current;
      if (!kind) return;
      if (c.getObjects().length >= MAX_OBJECTS) {
        toast.error(`Limite de ${MAX_OBJECTS} objetos atingido`);
        setShapeTool(null);
        return;
      }
      const { x, y } = opt.scenePoint;
      skipSave.current = true;
      const obj = createShape(kind, x, y, colorRef.current, Math.max(2, sizeRef.current / 2));
      c.add(obj);
      dragRef.current = { obj, kind, x0: x, y0: y };
    });

    c.on("mouse:move", (opt) => {
      const arrasto = dragRef.current;
      if (!arrasto) return;
      const { x, y } = opt.scenePoint;
      resizeShape(arrasto.obj, arrasto.kind, arrasto.x0, arrasto.y0, x, y);
      c.requestRenderAll();
    });

    c.on("mouse:up", () => {
      const arrasto = dragRef.current;
      if (!arrasto) return;
      dragRef.current = null;

      // Clique seco, sem arrastar: em vez de deixar um ponto invisível na tela,
      // entrega a forma num tamanho utilizável — que é o que a versão antiga
      // fazia sempre.
      const caixa = arrasto.obj.getBoundingRect();
      if (caixa.width < 6 && caixa.height < 6) {
        resizeShape(
          arrasto.obj, arrasto.kind, arrasto.x0, arrasto.y0,
          arrasto.x0 + TAMANHO_PADRAO.w, arrasto.y0 + TAMANHO_PADRAO.h,
        );
      }

      skipSave.current = false;
      saveState();
      c.setActiveObject(arrasto.obj);
      c.requestRenderAll();
      setShapeTool(null);
      setTool("select");
    });

    return () => { c.dispose(); canvasRef.current = null; undoStack.current = []; redoStack.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Enquanto uma forma está armada, o canvas não desenha à mão livre nem abre
  // retângulo de seleção — o arrasto pertence à forma.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (shapeTool) {
      c.isDrawingMode = false;
      c.selection = false;
      c.defaultCursor = "crosshair";
      c.discardActiveObject();
      c.requestRenderAll();
    } else {
      c.selection = true;
      c.defaultCursor = "default";
    }
  }, [shapeTool]);

  // Apply tool/color/size whenever they change
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (tool === "select") {
      c.isDrawingMode = false;
      return;
    }
    c.isDrawingMode = true;
    if (tool === "eraser") {
      const brush = new fabric.PencilBrush(c);
      brush.color = bgColor;
      brush.width = size * 2;
      c.freeDrawingBrush = brush;
    } else {
      const brush = new fabric.PencilBrush(c);
      brush.color = color;
      brush.width = tool === "pencil" ? Math.max(1, Math.round(size / 3)) : size;
      c.freeDrawingBrush = brush;
    }
  }, [tool, color, size, bgColor]);

  // Update bg color live
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.backgroundColor = bgColor;
    c.renderAll();
  }, [bgColor]);

  const guardCount = () => {
    if (!canvasRef.current) return false;
    if (canvasRef.current.getObjects().length >= MAX_OBJECTS) {
      toast.error(`Limite de ${MAX_OBJECTS} objetos atingido`);
      return false;
    }
    return true;
  };

  /** Arma a forma. O desenho só acontece quando se arrasta sobre a prancheta. */
  const startShape = (kind: ShapeKind) => {
    if (!guardCount()) return;
    setTool("select");
    setShapeTool((atual) => (atual === kind ? null : kind));
  };

  /** Texto continua sendo clique: arrastar não define tamanho de texto. */
  const addText = () => {
    const c = canvasRef.current;
    if (!c || !guardCount()) return;
    setShapeTool(null);
    const obj = new fabric.IText("Texto", {
      left: 80, top: 80, fill: color,
      fontSize: Math.max(16, size * 3), fontFamily: "DM Sans, sans-serif",
    });
    c.add(obj);
    c.setActiveObject(obj);
    setTool("select");
  };

  /** Troca de ferramenta livre desarma qualquer forma pendente. */
  const selectTool = (t: Tool) => {
    setShapeTool(null);
    setTool(t);
  };

  /**
   * Coloca uma imagem na prancheta, venha ela da área de transferência, de um
   * arquivo arrastado ou do botão.
   *
   * Vira data URL em vez de blob URL de propósito: a exportação para SVG e o
   * projeto .json guardam o endereço da imagem, e um blob URL morre junto com a
   * aba — o arquivo exportado sairia com um buraco no lugar da figura.
   */
  const addImage = useCallback(async (file: Blob) => {
    const c = canvasRef.current;
    if (!c) return;
    if (c.getObjects().length >= MAX_OBJECTS) {
      toast.error(`Limite de ${MAX_OBJECTS} objetos atingido`);
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result as string);
        leitor.onerror = () => reject(leitor.error ?? new Error("falha ao ler"));
        leitor.readAsDataURL(file);
      });
      const img = await fabric.FabricImage.fromURL(dataUrl);

      // Um print de tela costuma ser maior que a prancheta inteira. Entra
      // reduzido para caber, e quem usa aumenta depois se quiser.
      const limite = Math.min(c.getWidth(), c.getHeight()) * 0.9;
      const escala = Math.min(1, limite / Math.max(img.width || 1, img.height || 1));
      img.set({ left: 40, top: 40, scaleX: escala, scaleY: escala });

      c.add(img);
      c.setActiveObject(img);
      c.requestRenderAll();
      setShapeTool(null);
      setTool("select");
      toast.success("Imagem adicionada");
    } catch (e) {
      toast.error("Não foi possível ler essa imagem", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  /** Ctrl+V com uma imagem na área de transferência cola direto na prancheta. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      // O texto do fabric edita dentro de um textarea escondido; colar ali é
      // colar texto, não imagem.
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      const arquivo = item?.getAsFile();
      if (!arquivo) return;
      e.preventDefault();
      void addImage(arquivo);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addImage]);

  const undo = () => {
    const c = canvasRef.current;
    if (!c || undoStack.current.length <= 1) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1];
    skipSave.current = true;
    c.loadFromJSON(prev).then(() => { c.renderAll(); skipSave.current = false; });
  };

  const redo = () => {
    const c = canvasRef.current;
    if (!c || !redoStack.current.length) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    skipSave.current = true;
    c.loadFromJSON(next).then(() => { c.renderAll(); skipSave.current = false; });
  };

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    if (!confirm("Limpar a prancheta?")) return;
    c.clear();
    c.backgroundColor = bgColor;
    c.renderAll();
    saveState();
  };

  const deleteSelected = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const active = c.getActiveObjects();
    active.forEach((o) => c.remove(o));
    c.discardActiveObject();
    c.renderAll();
    saveState();
  }, [saveState]);

  const handleExport = (kind: "png" | "jpg" | "svg" | "json") => {
    const c = canvasRef.current;
    if (!c) return;
    try {
      if (kind === "png") toPng(c);
      else if (kind === "jpg") toJpg(c);
      else if (kind === "svg") toSvg(c);
      else toJson(c);
      toast.success(`Exportado como ${kind.toUpperCase()}`);
    } catch (e) {
      toast.error("Falha ao exportar", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  // Delete apaga o que estiver selecionado; Escape desarma a forma pendente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      // Escape só desarma a forma quando a prancheta está no tamanho normal.
      // Expandida, o Escape pertence ao modo expandido — se os dois
      // respondessem, sair da forma tiraria você da tela cheia junto. Para
      // desarmar ali, basta clicar de novo no botão da forma.
      if (e.key === "Escape") {
        if (!expanded) setShapeTool(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && canvasRef.current?.getActiveObjects().length) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, expanded]);

  return (
    <div
      // `select-none`: sem isso, um arrasto que passa da borda da prancheta
      // sai selecionando o texto da própria interface, e a página fica com
      // trechos realçados em azul no meio do desenho.
      className={
        expanded
          ? "fixed inset-0 z-50 flex flex-col gap-3 bg-background p-4 select-none"
          : "space-y-3 select-none"
      }
      // `margin: 0` no modo expandido não é enfeite: o painel que hospeda a
      // ferramenta usa `space-y-4`, que empurra cada filho com
      // `margin-top: 1rem`. Margem também desloca elemento posicionado, então o
      // overlay abria 16px abaixo do topo da janela e ficava 16px mais curto —
      // perto o bastante do certo para passar despercebido a olho nu.
      style={expanded ? { margin: 0 } : undefined}
    >
      <div className="flex flex-wrap items-center gap-1 p-2 rounded-lg border border-border bg-secondary/40 shrink-0">
        <TBtn active={tool === "select" && !shapeTool} onClick={() => selectTool("select")} label="Selecionar"><MousePointer2 className="w-4 h-4" /></TBtn>
        <TBtn active={tool === "brush"} onClick={() => selectTool("brush")} label="Pincel"><Brush className="w-4 h-4" /></TBtn>
        <TBtn active={tool === "pencil"} onClick={() => selectTool("pencil")} label="Lápis"><Pencil className="w-4 h-4" /></TBtn>
        <TBtn active={tool === "eraser"} onClick={() => selectTool("eraser")} label="Borracha"><Eraser className="w-4 h-4" /></TBtn>

        <div className="w-px h-6 bg-border mx-1" />

        <TBtn active={shapeTool === "rect"} onClick={() => startShape("rect")} label="Retângulo — arraste na prancheta para definir o tamanho"><Square className="w-4 h-4" /></TBtn>
        <TBtn active={shapeTool === "ellipse"} onClick={() => startShape("ellipse")} label="Círculo — arraste na prancheta para definir o tamanho"><CircleIcon className="w-4 h-4" /></TBtn>
        <TBtn active={shapeTool === "triangle"} onClick={() => startShape("triangle")} label="Triângulo — arraste na prancheta para definir o tamanho"><TriangleIcon className="w-4 h-4" /></TBtn>
        <TBtn active={shapeTool === "line"} onClick={() => startShape("line")} label="Linha — arraste na prancheta de uma ponta à outra"><Minus className="w-4 h-4" /></TBtn>
        <TBtn active={shapeTool === "star"} onClick={() => startShape("star")} label="Estrela — arraste na prancheta para definir o tamanho"><Star className="w-4 h-4" /></TBtn>
        <TBtn onClick={addText} label="Texto"><Type className="w-4 h-4" /></TBtn>

        <TBtn onClick={() => fileInputRef.current?.click()} label="Inserir imagem — ou cole com Ctrl+V, ou arraste o arquivo"><ImagePlus className="w-4 h-4" /></TBtn>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void addImage(arquivo);
            e.target.value = "";
          }}
        />

        <div className="w-px h-6 bg-border mx-1" />

        <label className="inline-flex items-center gap-2 px-2 text-xs" title="Cor do traço">
          <span className="text-muted-foreground">Cor</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-border" aria-label="Cor do traço" />
        </label>
        <label className="inline-flex items-center gap-2 px-2 text-xs" title="Cor de fundo">
          <span className="text-muted-foreground">Fundo</span>
          <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer bg-transparent border border-border" aria-label="Cor de fundo" />
        </label>

        <div className="inline-flex items-center gap-2 px-2 min-w-[160px]">
          <span className="text-xs text-muted-foreground">Espessura</span>
          <Slider value={[size]} min={1} max={50} step={1} onValueChange={(v) => setSize(v[0])} className="w-24" />
          <span className="text-xs w-6 text-right">{size}</span>
        </div>

        <div className="w-px h-6 bg-border mx-1" />

        <Select value={preset} onValueChange={setPreset}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SIZE_PRESETS.map(s => <SelectItem key={s.label} value={s.label}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <TBtn onClick={undo} label="Desfazer"><Undo2 className="w-4 h-4" /></TBtn>
        <TBtn onClick={redo} label="Refazer"><Redo2 className="w-4 h-4" /></TBtn>

        <div className="flex-1" />

        <TBtn active={expanded} onClick={toggle} label={expanded ? "Reduzir — Esc" : "Expandir para a janela inteira"}>
          {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </TBtn>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-2 h-8"><Download className="w-4 h-4" /> Exportar</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport("png")}>PNG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("jpg")}>JPG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("svg")}>SVG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("json")}>Projeto (.json)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <TBtn onClick={clear} label="Limpar"><Trash2 className="w-4 h-4" /></TBtn>
      </div>

      {/*
        A caixa era `resize` nos dois eixos e sem largura máxima: puxar a alça
        para o lado esticava a div além do cartão do site, e a prancheta
        aparecia por cima do resto da página. Pior, não adiantava nada — o
        canvas tem tamanho fixo, escolhido no seletor de proporção, então
        alargar a caixa só criava espaço vazio fora do lugar.

        Agora a alça é só vertical e a largura fica presa em 100% do cartão.
        Quem precisa de mais espaço horizontal usa o botão Expandir, que é o
        único jeito honesto de dar mais tela sem quebrar o layout.
      */}
      <div
        className={
          expanded
            ? "flex-1 min-h-0 rounded-lg border border-border bg-secondary/20 p-3 overflow-auto w-full flex justify-center"
            : "rounded-lg border border-border bg-secondary/20 p-3 overflow-auto resize-y w-full flex justify-center"
        }
        style={expanded ? undefined : { height: "60vh", minHeight: 320, maxWidth: "100%" }}
        title={expanded ? undefined : "Arraste o canto inferior direito para aumentar a altura"}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const arquivo = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
          if (!arquivo) return;
          e.preventDefault();
          void addImage(arquivo);
        }}
      >
        <canvas ref={canvasElRef} className="shadow-lg" />
      </div>

      <p className="text-xs text-muted-foreground px-2 shrink-0">
        {shapeTool
          ? "Arraste sobre a prancheta para desenhar a forma no tamanho que quiser. Um clique seco cria no tamanho padrão."
          : "Formas: clique no botão e arraste na prancheta para definir o tamanho. Imagens: Ctrl+V, arraste o arquivo ou use o botão. Selecionar move e redimensiona; Delete apaga."}
      </p>
    </div>
  );
};

export default Drawing;