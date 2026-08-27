import { useState, lazy, Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import {
  NEW_CONVERSIONS,
  conversionKey,
  formatMeta,
} from "@/lib/convert-formats";
import ConverterPicker, { type Choice } from "./converter/ConverterPicker";

// Os motores (jsPDF, pdf.js, xlsx, ffmpeg) só descem quando alguém escolhe uma
// conversão — assim a tela de escolha pode ficar na página inicial sem custo.
const ConverterStage = lazy(() => import("./converter/ConverterStage"));

const StageFallback = () => (
  <div className="flex items-center justify-center py-16 text-muted-foreground">
    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando conversor...
  </div>
);

interface Props {
  /** Texto de apoio da área de arrastar. */
  hint?: string;
}

const FileConverter = ({ hint }: Props) => {
  const [choice, setChoice] = useState<Choice | null>(null);

  if (!choice) {
    return <ConverterPicker onChoose={setChoice} hint={hint} />;
  }

  const fromMeta = formatMeta(choice.from);
  const toMeta = formatMeta(choice.to);
  const key = conversionKey(choice.from, choice.to);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => setChoice(null)} className="-ml-2 gap-2">
          <ArrowLeft className="h-4 w-4" /> Escolher outra conversão
        </Button>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {fromMeta?.label}
          <ArrowRight className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">{toMeta?.label}</span>
          {NEW_CONVERSIONS.has(key) && (
            <Badge variant="secondary" className="px-1.5 py-0 text-xs">Novo</Badge>
          )}
        </span>
      </div>

      <Suspense fallback={<StageFallback />}>
        <ConverterStage conversion={key} file={choice.file} />
      </Suspense>
    </div>
  );
};

export default FileConverter;
