import { useCallback, useEffect, useState } from "react";

/**
 * Modo expandido: a ferramenta passa a ocupar a janela inteira.
 *
 * Existe porque tanto o notepad quanto a prancheta vivem dentro de um cartão de
 * largura limitada, e esticar a caixa para fora dele quebra o layout do site em
 * vez de dar mais espaço. Aqui a ferramenta cobre a janela de propósito, com a
 * barra de ferramentas junto, e sai com Escape.
 *
 * Não usa a Fullscreen API do navegador: ela tira a barra de endereços e o
 * restante do site, o que é mais do que se quer, e em alguns navegadores exige
 * gesto do usuário a cada chamada.
 */
export function useExpanded() {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);

    // Trava a rolagem da página atrás, para o scroll do mouse ficar todo com a
    // ferramenta em vez de deslizar o site por baixo dela.
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = anterior;
    };
  }, [expanded]);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return { expanded, setExpanded, toggle };
}
