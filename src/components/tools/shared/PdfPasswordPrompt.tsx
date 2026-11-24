import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PasswordRequest } from "./use-pdf-password";

interface PromptProps {
  reason: PasswordRequest;
  /** Nome do arquivo, quando a ferramenta lida com mais de um. */
  fileName?: string;
  busy?: boolean;
  onSubmit: (password: string) => void;
}

/**
 * Pedido de senha de abertura de um PDF.
 *
 * Só aparece para o PDF que de fato tem senha de abertura: o que tem só senha
 * de proprietário (edição bloqueada) é aberto sozinho, sem perguntar nada.
 */
export const PdfPasswordPrompt = ({ reason, fileName, busy, onSubmit }: PromptProps) => {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value) onSubmit(value);
      }}
      className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Lock className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        {fileName ? `"${fileName}" pede senha para abrir` : "Este PDF pede senha para abrir"}
      </p>
      {reason === "incorrect" && <p className="text-sm text-destructive">Senha incorreta. Confira e tente de novo.</p>}
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Senha do PDF"
          aria-label={fileName ? `Senha de ${fileName}` : "Senha do PDF"}
        />
        <Button type="submit" variant="secondary" disabled={!value || busy} className="shrink-0">
          Desbloquear
        </Button>
      </div>
    </form>
  );
};

export default PdfPasswordPrompt;
