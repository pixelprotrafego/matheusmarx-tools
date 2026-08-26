import { Combine, Scissors, RotateCw, Stamp, Minimize2, ListOrdered, Layers, ImageDown } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import PdfMerger from "./PdfMerger";
import PdfCutter from "./PdfCutter";
import PdfRotator from "./PdfRotator";
import PdfWatermark from "./PdfWatermark";
import PdfCompressor from "./PdfCompressor";
import PdfReorder from "./PdfReorder";
import PdfFlatten from "./PdfFlatten";
import PdfExtractImages from "./PdfExtractImages";

const tools: SubTool[] = [
  { key: "merge", icon: Combine, title: "Unir PDF", description: "Combine múltiplos PDFs em um só arquivo", render: () => <PdfMerger /> },
  { key: "split", icon: Scissors, title: "Separar PDF", description: "Selecione páginas específicas para extrair", render: () => <PdfCutter /> },
  { key: "rotate", icon: RotateCw, title: "Rotacionar PDF", description: "Rotaciona páginas selecionadas", isNew: true, render: () => <PdfRotator /> },
  { key: "watermark", icon: Stamp, title: "Marca d'água", description: "Adiciona texto em diagonal em todas as páginas", isNew: true, render: () => <PdfWatermark /> },
  { key: "compress", icon: Minimize2, title: "Comprimir PDF", description: "Otimiza streams e metadados", isNew: true, render: () => <PdfCompressor /> },
  { key: "reorder", icon: ListOrdered, title: "Reordenar páginas", description: "Define a nova ordem das páginas", isNew: true, render: () => <PdfReorder /> },
  { key: "flatten", icon: Layers, title: "Achatar formulário", description: "Converte campos em conteúdo fixo", isNew: true, render: () => <PdfFlatten /> },
  { key: "extract", icon: ImageDown, title: "Extrair páginas em PNG", description: "Renderiza cada página como imagem", isNew: true, render: () => <PdfExtractImages /> },
];

const PdfToolsPanel = () => <SubToolPanel tools={tools} />;
export default PdfToolsPanel;
