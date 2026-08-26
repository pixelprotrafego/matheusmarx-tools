import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  message: string;
  onRetry?: () => void;
}

const ErrorState = ({ message, onRetry }: Props) => (
  <div className="flex items-center gap-3 bg-destructive/10 text-destructive rounded-lg p-4">
    <AlertTriangle className="w-5 h-5 shrink-0" />
    <p className="text-sm flex-1">{message}</p>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-1 shrink-0">
        <RotateCcw className="w-3 h-3" /> Tentar novamente
      </Button>
    )}
  </div>
);

export default ErrorState;