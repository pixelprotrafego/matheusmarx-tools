import { NotebookPen, Palette } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import Notepad from "./Notepad";
import Drawing from "./Drawing";

const tools: SubTool[] = [
  { key: "notepad", icon: NotebookPen, title: "Notepad", description: "Editor de texto com formatação rica · TXT/MD/HTML/PDF/DOCX", isNew: true, render: () => <Notepad /> },
  { key: "drawing", icon: Palette, title: "Prancheta de Desenho", description: "Pincéis, formas, texto e exportação PNG/JPG/SVG", isNew: true, render: () => <Drawing /> },
];

const CreativeToolsPanel = () => <SubToolPanel tools={tools} />;
export default CreativeToolsPanel;