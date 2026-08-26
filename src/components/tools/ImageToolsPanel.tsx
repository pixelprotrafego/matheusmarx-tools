import { Maximize2, Minimize2, Sparkles, ImageIcon } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import ImageResizer from "./ImageResizer";
import ImageCompressor from "./ImageCompressor";
import BackgroundRemover from "./BackgroundRemover";
import FaviconGenerator from "./FaviconGenerator";

const tools: SubTool[] = [
  { key: "resize", icon: Maximize2, title: "Redimensionar", description: "Mudar dimensões (px), batch + ZIP", isNew: true, render: () => <ImageResizer /> },
  { key: "compress", icon: Minimize2, title: "Comprimir Imagem", description: "JPEG/WEBP com qualidade ajustável", isNew: true, render: () => <ImageCompressor /> },
  { key: "bgremove", icon: Sparkles, title: "Remover Fundo (IA)", description: "Modelo ISNet rodando 100% no navegador", isNew: true, render: () => <BackgroundRemover /> },
  { key: "favicon", icon: ImageIcon, title: "Gerador de Favicon", description: "Cria pacote 16-512px + manifest.json", isNew: true, render: () => <FaviconGenerator /> },
];

const ImageToolsPanel = () => <SubToolPanel tools={tools} />;
export default ImageToolsPanel;