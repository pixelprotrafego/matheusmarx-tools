import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const PdfPassword = () => {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4">
        <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
        <div className="space-y-2 text-sm">
          <p className="font-medium text-foreground">Proteção por senha temporariamente indisponível</p>
          <p className="text-muted-foreground">
            Por segurança, removemos a proteção "fake" anterior — ela apenas marcava o PDF sem criptografar.
            A criptografia AES real exige bibliotecas pesadas (qpdf-wasm ~2 MB) que estamos avaliando para a próxima versão.
          </p>
          <p className="text-muted-foreground">
            Enquanto isso, use o LibreOffice (Arquivo → Exportar como PDF → Segurança) ou o Adobe Acrobat
            para aplicar senhas fortes de verdade.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => toast.message("Em breve!", { description: "Estamos integrando criptografia AES-256 real." })}
        className="text-xs text-muted-foreground underline"
      >
        Me avise quando estiver pronto
      </button>
    </div>
  );
};

export default PdfPassword;