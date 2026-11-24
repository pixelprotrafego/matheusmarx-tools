/**
 * Intervalos de página digitados à mão: "1-3,5,8-10".
 *
 * Usado pelo site e pelo bot do Telegram. Fica num lugar só porque cada cópia
 * acabava aceitando coisas diferentes: uma ignorava em silêncio o que não
 * entendia e tratava "0" como página 1, e a pessoa recebia um PDF com páginas
 * que não pediu.
 */

/** Palavras que querem dizer "o documento inteiro". */
const ALL = new Set(["", "all", "todas", "tudo", "todos"]);

/** O texto pede todas as páginas? */
export const isAllPages = (input: string): boolean => ALL.has(input.trim().toLowerCase());

/**
 * Índices 0-based, sem repetição e em ordem crescente.
 *
 * Faixa invertida ("5-3") vale como "3-5". Página fora do documento é
 * ignorada, mas um trecho que não é número nem faixa é erro — melhor avisar do
 * que adivinhar o que a pessoa quis dizer.
 */
export function parsePageRange(input: string, total: number): number[] {
  const paginas = new Set<number>();
  for (const parte of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const faixa = parte.match(/^(\d+)\s*-\s*(\d+)$/);
    if (faixa) {
      let a = parseInt(faixa[1], 10);
      let b = parseInt(faixa[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(a, 1); i <= Math.min(b, total); i++) paginas.add(i - 1);
    } else if (/^\d+$/.test(parte)) {
      const n = parseInt(parte, 10);
      if (n >= 1 && n <= total) paginas.add(n - 1);
    } else {
      throw new Error(`Intervalo inválido: "${parte}"`);
    }
  }
  if (paginas.size === 0) throw new Error(`Nenhuma página válida no intervalo (o PDF tem ${total}).`);
  return [...paginas].sort((a, b) => a - b);
}

/**
 * Nova ordem de páginas: "3,1,2" ou "5-1". Diferente de `parsePageRange`, a
 * ordem digitada é respeitada, repetir uma página vale (vira cópia) e faixa
 * decrescente inverte as páginas. Página que não existe é erro, e não sumiço
 * silencioso: no reordenar, uma página que some do resultado é dado perdido.
 */
export function parsePageOrder(input: string, total: number): number[] {
  const ordem: number[] = [];
  const confere = (n: number) => {
    if (n < 1 || n > total) throw new Error(`A página ${n} não existe: o PDF tem ${total}.`);
    return n - 1;
  };
  for (const parte of input.split(",").map((s) => s.trim()).filter(Boolean)) {
    const faixa = parte.match(/^(\d+)\s*-\s*(\d+)$/);
    if (faixa) {
      const a = confere(parseInt(faixa[1], 10));
      const b = confere(parseInt(faixa[2], 10));
      const passo = a <= b ? 1 : -1;
      for (let i = a; i !== b + passo; i += passo) ordem.push(i);
    } else if (/^\d+$/.test(parte)) {
      ordem.push(confere(parseInt(parte, 10)));
    } else {
      throw new Error(`Intervalo inválido: "${parte}"`);
    }
  }
  if (!ordem.length) throw new Error("Informe ao menos uma página.");
  return ordem;
}

/** Como `parsePageRange`, mas "all", "todas" ou vazio devolvem o documento inteiro. */
export function parsePageSelection(input: string, total: number): number[] {
  if (isAllPages(input)) return Array.from({ length: total }, (_, i) => i);
  return parsePageRange(input, total);
}
