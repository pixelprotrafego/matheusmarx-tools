import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface Props {
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  loadingLabel?: string;
}

const ConvertButton = ({ onClick, loading, disabled, label = "Converter", loadingLabel = "Processando..." }: Props) => (
  <div className="flex justify-center">
    <Button onClick={onClick} disabled={loading || disabled} className="gap-2 min-w-[180px]">
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {loading ? loadingLabel : label}
    </Button>
  </div>
);

export default ConvertButton;