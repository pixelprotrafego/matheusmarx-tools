import { Calculator as CalcIcon, Ruler } from "lucide-react";
import SubToolPanel, { type SubTool } from "./shared/SubToolPanel";
import Calculator from "./Calculator";
import UnitConverter from "./UnitConverter";

const tools: SubTool[] = [
  {
    key: "calculator",
    icon: CalcIcon,
    title: "Calculadora",
    description: "Calculadora científica completa com histórico e atalhos de teclado",
    isNew: true,
    render: () => <Calculator />,
  },
  {
    key: "unit-converter",
    icon: Ruler,
    title: "Conversor de Unidades",
    description: "Distância, peso, temperatura, velocidade, volume, área, tempo, dados e mais",
    isNew: true,
    render: () => <UnitConverter />,
  },
];

const CalcToolsPanel = () => <SubToolPanel tools={tools} />;

export default CalcToolsPanel;