import { createContext, useContext, useEffect, useRef } from "react";

/**
 * O arquivo que o usuário soltou na entrada única da conversão.
 *
 * Cada conversor continua sendo uma tela independente, com o próprio seletor de
 * arquivo — quem abre o conversor direto não perde nada. Este contexto só evita
 * que quem já soltou o arquivo lá em cima tenha que escolhê-lo de novo.
 */
export const DroppedFileContext = createContext<File | null>(null);

export const useDroppedFile = (): File | null => useContext(DroppedFileContext);

/**
 * Entrega ao conversor o arquivo que já veio da tela anterior, uma única vez.
 *
 * O `adopt` fica numa ref porque quase sempre é uma função recriada a cada
 * render; sem isso o efeito dispararia em loop e o conversor reiniciaria
 * sozinho no meio da conversão.
 */
export function useAdoptDroppedFile(adopt: (file: File) => void): void {
  const dropped = useDroppedFile();
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;

  useEffect(() => {
    if (dropped) adoptRef.current(dropped);
  }, [dropped]);
}
