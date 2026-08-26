import { Mic, Volume2 } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import AudioTranscriber from "./AudioTranscriber";
import TextToSpeech from "./TextToSpeech";

const tools: SubTool[] = [
  {
    key: "transcribe",
    icon: Mic,
    title: "Transcrição de Áudio",
    description: "Converta áudios em texto com alta precisão (PT, EN, ES e mais)",
    isNew: true,
    render: () => <AudioTranscriber />,
  },
  {
    key: "tts",
    icon: Volume2,
    title: "Texto para Fala",
    description: "Transforme texto em áudio natural (inglês), com 8 vozes",
    isNew: true,
    render: () => <TextToSpeech />,
  },
];

const VoiceToolsPanel = () => <SubToolPanel tools={tools} />;
export default VoiceToolsPanel;