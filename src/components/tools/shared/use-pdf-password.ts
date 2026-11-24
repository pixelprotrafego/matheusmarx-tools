import { useCallback, useState } from "react";
import { PdfPasswordError } from "@/lib/pdf-unlock";

export type PasswordRequest = "required" | "incorrect";

/**
 * Estado do pedido de senha de uma ferramenta de arquivo único.
 *
 * Uso: a operação recebe a senha como parâmetro (`go(password)`), passa o erro
 * por `catchPassword` e, quando era falta de senha, a tela mostra `request`.
 * Ao enviar, `provide` guarda a senha e a ferramenta chama a operação de novo
 * com ela — por parâmetro, porque o estado do React só muda no próximo render.
 */
export function usePdfPassword() {
  const [request, setRequest] = useState<PasswordRequest | null>(null);
  const [password, setPassword] = useState<string | undefined>(undefined);

  /** Devolve `true` quando o erro era de senha, e aí o pedido já está na tela. */
  const catchPassword = useCallback((err: unknown): boolean => {
    if (!(err instanceof PdfPasswordError)) return false;
    setRequest(err.reason);
    return true;
  }, []);

  const provide = useCallback((value: string) => {
    setPassword(value);
    setRequest(null);
  }, []);

  /** Esquece a senha: arquivo novo, senha nova. */
  const reset = useCallback(() => {
    setRequest(null);
    setPassword(undefined);
  }, []);

  return { password, request, catchPassword, provide, reset };
}

