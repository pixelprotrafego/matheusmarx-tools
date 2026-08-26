import { Button } from "@/components/ui/button";
import { X, FileIcon } from "lucide-react";

interface Props {
  file: File;
  onRemove?: () => void;
  icon?: React.ReactNode;
}

const FileBadge = ({ file, onRemove, icon }: Props) => (
  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
    <div className="flex items-center gap-2 min-w-0">
      {icon ?? <FileIcon className="w-4 h-4 text-primary shrink-0" />}
      <span className="text-sm text-foreground truncate">{file.name}</span>
      <span className="text-xs text-muted-foreground shrink-0">
        ({(file.size / (1024 * 1024)).toFixed(2)} MB)
      </span>
    </div>
    {onRemove && (
      <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remover">
        <X className="w-4 h-4" />
      </Button>
    )}
  </div>
);

export default FileBadge;