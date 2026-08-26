import { QrCode, KeyRound, Binary, Hash, Braces, ShieldOff, EyeOff } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import QrGenerator from "./QrGenerator";
import PasswordGenerator from "./PasswordGenerator";
import Base64Tool from "./Base64Tool";
import HashTool from "./HashTool";
import JsonFormatter from "./JsonFormatter";
import MetadataScrubber from "./MetadataScrubber";
import SteganographyTool from "./SteganographyTool";

const tools: SubTool[] = [
  { key: "qr", icon: QrCode, title: "Gerador de QR Code", description: "Texto/URL → QR PNG com cores e nível de correção", isNew: true, render: () => <QrGenerator /> },
  { key: "password", icon: KeyRound, title: "Gerador de Senhas", description: "Senhas fortes geradas no navegador (até 64 chars)", isNew: true, render: () => <PasswordGenerator /> },
  { key: "metadata", icon: ShieldOff, title: "Limpar Metadados (EXIF/PDF)", description: "Remove EXIF, GPS, autor e XMP de imagens e metadados de PDFs", isNew: true, render: () => <MetadataScrubber /> },
  { key: "stego", icon: EyeOff, title: "Mensagem Oculta em Imagem", description: "Esconde texto ou arquivo cifrado dentro de um PNG (esteganografia LSB)", isNew: true, render: () => <SteganographyTool /> },
  { key: "base64", icon: Binary, title: "Base64", description: "Codificar e decodificar texto em Base64", render: () => <Base64Tool /> },
  { key: "hash", icon: Hash, title: "Hash & SHA", description: "Calcular e verificar SHA-1 / 256 / 384 / 512", render: () => <HashTool /> },
  { key: "json", icon: Braces, title: "JSON", description: "Formatar e minificar JSON", render: () => <JsonFormatter /> },
];

const TextToolsPanel = () => <SubToolPanel tools={tools} />;
export default TextToolsPanel;