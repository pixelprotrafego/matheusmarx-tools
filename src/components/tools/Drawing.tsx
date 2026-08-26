import { useEffect, useRef, useState, useCallback } from "react";
import * as fabric from "fabric";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Pencil, Brush, Eraser, MousePointer2, Square, Circle as CircleIcon, Triangle as TriangleIcon,
  Minus, Star, Type, Undo2, Redo2, Trash2, Download,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toPng, toJpg, toSvg, toJson } from "@/lib/drawing-export";

type Tool = "select" | "pencil" | "brush" | "eraser";

const SIZE_PRESETS = [
  { label: "1080 × 1080", w: 1080, h: 1080 },
  { label: "1920 × 1080", w: 1920, h: 1080 },
  { label: "800 × 600", w: 800, h: 600 },
  { label: "A4 retrato", w: 794, h: 1123 },
  { label: "A4 paisagem", w: 1123, h: 794 },
];

const MAX_OBJECTS = 1000;

const TBtn = ({ active, onClick, label, children, disabled }: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean; }) => (
  <Button type="button" size="sm" variant={active ? "default" : "ghost"} onClick={onClick} aria-label={label} title={label} disabled={disabled} className="h-8 w-8 p-0">
    {children}
  </Button>
);

const Drawing = () => {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const skipSave = useRef(false);

  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#e0bf3a");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [size, setSize] = useState(8);
  const [preset, setPreset] = useState(SIZE_PRESETS[0].label);

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
    return () => { c.dispose(); canvasRef.current = null; undoStack.current = []; redoStack.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

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

  const addShape = (kind: "rect" | "circle" | "triangle" | "line" | "star" | "text") => {
    const c = canvasRef.current;
    if (!c || !guardCount()) return;
    let obj: fabric.Object;
    const common = { left: 80, top: 80, fill: "transparent", stroke: color, strokeWidth: Math.max(2, size / 2) };
    if (kind === "rect") obj = new fabric.Rect({ ...common, width: 160, height: 100 });
    else if (kind === "circle") obj = new fabric.Circle({ ...common, radius: 60 });
    else if (kind === "triangle") obj = new fabric.Triangle({ ...common, width: 140, height: 120 });
    else if (kind === "line") obj = new fabric.Line([20, 20, 200, 20], { stroke: color, strokeWidth: Math.max(2, size / 2), left: 80, top: 120 });
    else if (kind === "star") {
      const r1 = 70, r2 = 30, n = 5;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? r1 : r2;
        const a = (Math.PI / n) * i - Math.PI / 2;
        pts.push({ x: r * Math.cos(a) + r1, y: r * Math.sin(a) + r1 });
      }
      obj = new fabric.Polygon(pts, { ...common });
    } else {
      obj = new fabric.IText("Texto", { left: 80, top: 80, fill: color, fontSize: Math.max(16, size * 3), fontFamily: "DM Sans, sans-serif" });
    }
    c.add(obj);
    c.setActiveObject(obj);
    setTool("select");
  };

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

  const deleteSelected = () => {
    const c = canvasRef.current;
    if (!c) return;
    const active = c.getActiveObjects();
    active.forEach((o) => c.remove(o));
    c.discardActiveObject();
    c.renderAll();
    saveState();
  };

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

  // Keyboard delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && canvasRef.current?.getActiveObjects().length) {
        const t = e.target as HTMLElement;
        if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 p-2 rounded-lg border border-border bg-secondary/40">
        <TBtn active={tool === "select"} onClick={() => setTool("select")} label="Selecionar"><MousePointer2 className="w-4 h-4" /></TBtn>
        <TBtn active={tool === "brush"} onClick={() => setTool("brush")} label="Pincel"><Brush className="w-4 h-4" /></TBtn>
        <TBtn active={tool === "pencil"} onClick={() => setTool("pencil")} label="Lápis"><Pencil className="w-4 h-4" /></TBtn>
        <TBtn active={tool === "eraser"} onClick={() => setTool("eraser")} label="Borracha"><Eraser className="w-4 h-4" /></TBtn>

        <div className="w-px h-6 bg-border mx-1" />

        <TBtn onClick={() => addShape("rect")} label="Retângulo"><Square className="w-4 h-4" /></TBtn>
        <TBtn onClick={() => addShape("circle")} label="Círculo"><CircleIcon className="w-4 h-4" /></TBtn>
        <TBtn onClick={() => addShape("triangle")} label="Triângulo"><TriangleIcon className="w-4 h-4" /></TBtn>
        <TBtn onClick={() => addShape("line")} label="Linha"><Minus className="w-4 h-4" /></TBtn>
        <TBtn onClick={() => addShape("star")} label="Estrela"><Star className="w-4 h-4" /></TBtn>
        <TBtn onClick={() => addShape("text")} label="Texto"><Type className="w-4 h-4" /></TBtn>

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

      <div
        className="rounded-lg border border-border bg-secondary/20 p-3 overflow-auto resize w-full flex justify-center"
        style={{ height: "60vh", minHeight: 320, minWidth: 280, maxHeight: "90vh" }}
        title="Arraste o canto inferior direito para redimensionar"
      >
        <canvas ref={canvasElRef} className="shadow-lg" />
      </div>

      <p className="text-xs text-muted-foreground px-2">
        Dica: clique em uma forma com a ferramenta Selecionar para mover, redimensionar e rotacionar. Tecla Delete remove o que estiver selecionado.
      </p>
    </div>
  );
};

export default Drawing;