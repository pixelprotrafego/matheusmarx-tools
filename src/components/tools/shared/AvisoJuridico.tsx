import { AlertTriangle } from "lucide-react";

/**
 * Aviso fixo das ferramentas jurídicas.
 *
 * Não é formalidade: prazo perdido e verba calculada a menos têm consequência
 * real para quem confia no número. A ferramenta ajuda a conferir uma conta,
 * não substitui a conferência.
 */
const AvisoJuridico = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
    <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
  </div>
);

export default AvisoJuridico;
