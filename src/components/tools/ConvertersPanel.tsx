import { FileText, Music } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import FileConverter from "./FileConverter";
import MediaConverter from "./MediaConverter";

const tools: SubTool[] = [
  {
    key: "files",
    icon: FileText,
    title: "Conversão de Arquivos",
    description: "PDF, DOCX, Excel, imagens, HEIC, SVG, Markdown, HTML, JSON, YAML",
    render: () => <FileConverter />,
  },
  {
    key: "media",
    icon: Music,
    title: "Conversão de Mídia",
    description: "Matriz completa de áudio/vídeo (MP4, MKV, WEBM, MP3, M4A, OPUS...)",
    render: () => <MediaConverter />,
  },
];

const ConvertersPanel = () => <SubToolPanel tools={tools} />;
export default ConvertersPanel;