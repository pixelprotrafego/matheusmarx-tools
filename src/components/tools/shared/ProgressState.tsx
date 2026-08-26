import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

interface Props {
  progress?: number;
  status?: string;
}

const ProgressState = ({ progress, status }: Props) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <Loader2 className="w-4 h-4 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">{status ?? "Processando..."}</span>
    </div>
    {typeof progress === "number" && <Progress value={progress} />}
  </div>
);

export default ProgressState;