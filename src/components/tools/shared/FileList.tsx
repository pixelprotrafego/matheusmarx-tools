import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, X } from "lucide-react";

interface Props {
  files: File[];
  onReorder: (files: File[]) => void;
  onRemove: (index: number) => void;
}

const FileList = ({ files, onReorder, onRemove }: Props) => {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= files.length) return;
    const copy = [...files];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onReorder(copy);
  };
  return (
    <ul className="space-y-2">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
          <span className="text-xs text-muted-foreground w-6">{i + 1}.</span>
          <span className="flex-1 truncate text-sm">{f.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{(f.size / (1024 * 1024)).toFixed(1)} MB</span>
          <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">
            <ChevronUp className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => move(i, 1)} disabled={i === files.length - 1} aria-label="Descer">
            <ChevronDown className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onRemove(i)} aria-label="Remover">
            <X className="w-4 h-4" />
          </Button>
        </li>
      ))}
    </ul>
  );
};

export default FileList;