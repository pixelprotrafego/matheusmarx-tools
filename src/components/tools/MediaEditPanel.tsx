import { Maximize2, Minimize2, Sparkles, ImageIcon, Scissors, Combine, Film, Frame, Music, Repeat } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import MediaConverter from "./MediaConverter";
import ImageResizer from "./ImageResizer";
import ImageCompressor from "./ImageCompressor";
import BackgroundRemover from "./BackgroundRemover";
import FaviconGenerator from "./FaviconGenerator";
import Mp4Cutter from "./Mp4Cutter";
import VideoJoiner from "./VideoJoiner";
import VideoToGif from "./VideoToGif";
import VideoCompressor from "./VideoCompressor";
import VideoResizer from "./VideoResizer";
import VideoFrameExtractor from "./VideoFrameExtractor";
import AudioExtractor from "./AudioExtractor";

const tools: SubTool[] = [
  // Conversão de áudio e vídeo. Veio do cartão "Conversão de Arquivos & Mídia",
  // que deixou de existir quando a conversão de arquivos subiu para o topo da
  // página inicial: aqui ela fica junto do resto de áudio e vídeo.
  {
    key: "media-convert",
    icon: Repeat,
    title: "Conversão de Mídia",
    description: "Matriz completa de áudio/vídeo (MP4, MKV, WEBM, MP3, M4A, OPUS...)",
    render: () => <MediaConverter />,
  },
  // Imagem
  { key: "img-resize", icon: Maximize2, title: "Redimensionar Imagem", description: "Mudar dimensões (px), batch + ZIP", isNew: true, render: () => <ImageResizer /> },
  { key: "img-compress", icon: Minimize2, title: "Comprimir Imagem", description: "JPEG/WEBP com qualidade ajustável", isNew: true, render: () => <ImageCompressor /> },
  { key: "img-bgremove", icon: Sparkles, title: "Remover Fundo (IA)", description: "Modelo ISNet rodando 100% no navegador", isNew: true, render: () => <BackgroundRemover /> },
  { key: "img-favicon", icon: ImageIcon, title: "Gerador de Favicon", description: "Cria pacote 16-512px + manifest.json", isNew: true, render: () => <FaviconGenerator /> },
  // Vídeo
  { key: "vid-cut", icon: Scissors, title: "Cortar Vídeo", description: "Seleciona um trecho específico", render: () => <Mp4Cutter /> },
  { key: "vid-join", icon: Combine, title: "Unir Vídeos", description: "Combina 2+ vídeos em um", render: () => <VideoJoiner /> },
  { key: "vid-gif", icon: Film, title: "Vídeo → GIF", description: "Gera GIF de um trecho", isNew: true, render: () => <VideoToGif /> },
  { key: "vid-compress", icon: Minimize2, title: "Comprimir Vídeo", description: "Alta/Média/Baixa qualidade", isNew: true, render: () => <VideoCompressor /> },
  { key: "vid-resize", icon: Maximize2, title: "Mudar Resolução", description: "1080p/720p/480p/360p", isNew: true, render: () => <VideoResizer /> },
  { key: "vid-frames", icon: Frame, title: "Extrair Frames", description: "Exporta como ZIP de PNGs", isNew: true, render: () => <VideoFrameExtractor /> },
  { key: "vid-audio", icon: Music, title: "Extrair Áudio", description: "MP3/WAV/AAC/FLAC", isNew: true, render: () => <AudioExtractor /> },
];

const MediaEditPanel = () => <SubToolPanel tools={tools} />;
export default MediaEditPanel;