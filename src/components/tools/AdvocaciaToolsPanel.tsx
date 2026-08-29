import { CalendarClock, ScanSearch, Sparkles, Wallet } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import PrazoProcessual from "./PrazoProcessual";
import CnjValidator from "./CnjValidator";
import CnjGenerator from "./CnjGenerator";
import RescisaoCalculator from "./RescisaoCalculator";

const tools: SubTool[] = [
  {
    key: "prazo-processual",
    icon: CalendarClock,
    title: "Contador de Prazos",
    description: "Dias úteis ou corridos, com feriados, recesso forense e as datas da sua comarca",
    isNew: true,
    render: () => <PrazoProcessual />,
  },
  {
    key: "cnj-validador",
    icon: ScanSearch,
    title: "Validador de Processo CNJ",
    description: "Confere o dígito verificador e diz em que justiça e estado o processo tramita",
    isNew: true,
    render: () => <CnjValidator />,
  },
  {
    key: "cnj-gerador",
    icon: Sparkles,
    title: "Gerador de Processo CNJ",
    description: "Números fictícios com estrutura válida, para modelos de petição e testes de sistema",
    isNew: true,
    render: () => <CnjGenerator />,
  },
  {
    key: "rescisao",
    icon: Wallet,
    title: "Calculadora de Rescisão",
    description: "Verbas rescisórias da CLT, FGTS com multa, INSS e IRRF até o líquido",
    isNew: true,
    render: () => <RescisaoCalculator />,
  },
];

const AdvocaciaToolsPanel = () => <SubToolPanel tools={tools} />;

export default AdvocaciaToolsPanel;
