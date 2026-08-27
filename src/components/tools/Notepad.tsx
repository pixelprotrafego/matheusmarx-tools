import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { FontFamily } from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, ListChecks, Quote, Code, Heading1, Heading2, Heading3,
  Undo2, Redo2, Trash2, Download, FileText, FileType, FileCode, FileImage,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toTxt, toMd, toHtml, toPdf, toDocx } from "@/lib/notepad-export";

const STORAGE_KEY = "mm-notepad-draft";
const MAX_CHARS = 500_000;

const FONT_FAMILIES = [
  { label: "Sans", value: "Inter, system-ui, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'JetBrains Mono', 'Courier New', monospace" },
  { label: "Sora", value: "Sora, sans-serif" },
  { label: "DM Sans", value: "'DM Sans', sans-serif" },
];

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60, 72];

const ToolbarButton = ({
  active, onClick, label, children, disabled,
}: { active?: boolean; onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean }) => (
  <Button
    type="button"
    size="sm"
    variant={active ? "default" : "ghost"}
    onClick={onClick}
    aria-label={label}
    title={label}
    disabled={disabled}
    className="h-8 w-8 p-0"
  >
    {children}
  </Button>
);

const Notepad = () => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState("16");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TextStyle,
      FontSize,
      FontFamily.configure({ types: ["textStyle"] }),
      Color.configure({ types: ["textStyle"] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) || "<p></p>" : "<p></p>",
    editorProps: {
      attributes: {
        class: "prose prose-invert max-w-none focus:outline-none min-h-[400px] p-6",
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      if (text.length > MAX_CHARS) {
        toast.error(`Limite de ${MAX_CHARS.toLocaleString()} caracteres atingido`);
        return;
      }
      try { localStorage.setItem(STORAGE_KEY, editor.getHTML()); } catch { /* storage cheio ou bloqueado */ }
    },
  });

  useEffect(() => () => editor?.destroy(), [editor]);

  if (!editor) return null;

  const setFontSizePx = (px: string) => {
    setFontSize(px);
    // setFontSize vem da extensão TextStyle, fora da tipagem base do chain().
    (editor.chain().focus() as unknown as { setFontSize(v: string): { run(): void } })
      .setFontSize(`${px}px`)
      .run();
  };

  const wordCount = editor.getText().trim().split(/\s+/).filter(Boolean).length;
  const charCount = editor.getText().length;

  const clear = () => {
    if (!confirm("Limpar todo o conteúdo? Essa ação não pode ser desfeita.")) return;
    editor.commands.clearContent();
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage bloqueado */ }
    toast.success("Notepad limpo");
  };

  const handleExport = async (kind: "txt" | "md" | "html" | "pdf" | "docx") => {
    try {
      if (kind === "txt") toTxt(editor);
      else if (kind === "md") await toMd(editor);
      else if (kind === "html") await toHtml(editor);
      else if (kind === "docx") await toDocx(editor);
      else if (kind === "pdf") {
        if (!contentRef.current) return;
        await toPdf(contentRef.current);
      }
      toast.success(`Exportado como ${kind.toUpperCase()}`);
    } catch (e) {
      toast.error("Falha ao exportar", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 p-2 rounded-lg border border-border bg-secondary/40">
        <Select value="" onValueChange={(v) => editor.chain().focus().setFontFamily(v).run()}>
          <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Fonte" /></SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map(f => <SelectItem key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={fontSize} onValueChange={setFontSizePx}>
          <SelectTrigger className="h-8 w-[70px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FONT_SIZES.map(s => <SelectItem key={s} value={String(s)}>{s}px</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="w-px h-6 bg-border mx-1" />

        <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label="Negrito"><Bold className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label="Itálico"><Italic className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Sublinhado"><UnderlineIcon className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} label="Tachado"><Strikethrough className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} label="Código inline"><Code className="w-4 h-4" /></ToolbarButton>

        <label className="inline-flex items-center gap-1 px-1" title="Cor do texto">
          <input
            type="color"
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-border"
            aria-label="Cor do texto"
          />
        </label>
        <label className="inline-flex items-center gap-1 px-1" title="Cor de destaque">
          <input
            type="color"
            onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
            className="w-6 h-6 rounded cursor-pointer bg-transparent border border-border"
            aria-label="Cor de destaque"
          />
        </label>

        <div className="w-px h-6 bg-border mx-1" />

        <ToolbarButton active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} label="Título 1"><Heading1 className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label="Título 2"><Heading2 className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} label="Título 3"><Heading3 className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Citação"><Quote className="w-4 h-4" /></ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        <ToolbarButton active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} label="Esquerda"><AlignLeft className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} label="Centro"><AlignCenter className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} label="Direita"><AlignRight className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} label="Justificado"><AlignJustify className="w-4 h-4" /></ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Lista com bullets"><List className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Lista numerada"><ListOrdered className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label="Checklist"><ListChecks className="w-4 h-4" /></ToolbarButton>

        <div className="w-px h-6 bg-border mx-1" />

        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} label="Desfazer" disabled={!editor.can().undo()}><Undo2 className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} label="Refazer" disabled={!editor.can().redo()}><Redo2 className="w-4 h-4" /></ToolbarButton>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="gap-2 h-8"><Download className="w-4 h-4" /> Exportar</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleExport("txt")}><FileText className="w-4 h-4 mr-2" /> TXT</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("md")}><FileCode className="w-4 h-4 mr-2" /> Markdown</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("html")}><FileCode className="w-4 h-4 mr-2" /> HTML</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("pdf")}><FileImage className="w-4 h-4 mr-2" /> PDF</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("docx")}><FileType className="w-4 h-4 mr-2" /> DOCX</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarButton onClick={clear} label="Limpar tudo"><Trash2 className="w-4 h-4" /></ToolbarButton>
      </div>

      <div
        ref={contentRef}
        className="rounded-lg border border-border bg-background tiptap-shell overflow-auto resize-y w-full"
        style={{ height: "60vh", minHeight: 280, maxHeight: "90vh" }}
        title="Arraste o canto inferior direito para redimensionar"
      >
        <EditorContent editor={editor} />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground px-2">
        <span>{wordCount} palavras · {charCount.toLocaleString()} caracteres</span>
        <span>Rascunho salvo automaticamente</span>
      </div>
    </div>
  );
};

export default Notepad;