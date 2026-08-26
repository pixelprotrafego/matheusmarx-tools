import { Scissors, Combine, Film, Minimize2, Maximize2, Frame, Music } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import Mp4Cutter from "./Mp4Cutter";
import VideoJoiner from "./VideoJoiner";
import VideoToGif from "./VideoToGif";
import VideoCompressor from "./VideoCompressor";
import VideoResizer from "./VideoResizer";
import VideoFrameExtractor from "./VideoFrameExtractor";
import AudioExtractor from "./AudioExtractor";

const tools: SubTool[] = [
  { key: "cut", icon: Scissors, title: "Cortar Vídeo", description: "Seleciona um trecho específico", render: () => <Mp4Cutter /> },
  { key: "join", icon: Combine, title: "Unir Vídeos", description: "Combina 2+ vídeos em um", render: () => <VideoJoiner /> },
  { key: "gif", icon: Film, title: "Vídeo → GIF", description: "Gera GIF de um trecho", isNew: true, render: () => <VideoToGif /> },
  { key: "compress", icon: Minimize2, title: "Comprimir Vídeo", description: "Alta/Média/Baixa qualidade", isNew: true, render: () => <VideoCompressor /> },
  { key: "resize", icon: Maximize2, title: "Mudar Resolução", description: "1080p/720p/480p/360p", isNew: true, render: () => <VideoResizer /> },
  { key: "frames", icon: Frame, title: "Extrair Frames", description: "Exporta como ZIP de PNGs", isNew: true, render: () => <VideoFrameExtractor /> },
  { key: "audio", icon: Music, title: "Extrair Áudio", description: "MP3/WAV/AAC/FLAC", isNew: true, render: () => <AudioExtractor /> },
];

const VideoToolsPanel = () => <SubToolPanel tools={tools} />;
export default VideoToolsPanel;