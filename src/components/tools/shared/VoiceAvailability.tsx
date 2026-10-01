import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { getVoiceStatus, type VoiceStatus } from "@/lib/voice-api";

/** Estado das ferramentas de áudio nesta instalação; `null` enquanto pergunta ao servidor. */
export function useVoiceStatus(): VoiceStatus | null {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    let vivo = true;
    getVoiceStatus().then((s) => vivo && setStatus(s));
    return () => {
      vivo = false;
    };
  }, []);
  return status;
}

const MENSAGENS = {
  "no-server": {
    titulo: "Indisponível nesta instalação",
    texto:
      "Transcrição e texto para fala dependem do servidor do projeto (a pasta api/), que roda na Vercel. " +
      "Esta instalação serve só o site — é o caso da imagem Docker e do npm run dev. " +
      "Todas as outras ferramentas funcionam normalmente.",
  },
  "not-configured": {
    titulo: "Servidor sem chave configurada",
    texto: "O servidor está no ar, mas sem a variável GROQ_API_KEY. Quem mantém esta instalação precisa cadastrá-la.",
  },
} as const;

/** Aviso exibido no lugar do botão quando o áudio não está disponível. */
export function VoiceUnavailable({ reason }: { reason: "no-server" | "not-configured" }) {
  const m = MENSAGENS[reason];
  return (
    <div role="status" className="flex gap-3 rounded-lg border border-border bg-secondary/40 p-4 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="font-medium text-foreground">{m.titulo}</p>
        <p className="text-muted-foreground">{m.texto}</p>
      </div>
    </div>
  );
}
