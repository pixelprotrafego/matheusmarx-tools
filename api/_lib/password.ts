// Sem os caracteres que se confundem na leitura: l, o, I, O, 0, 1.
const MINUSCULAS = "abcdefghijkmnpqrstuvwxyz";
const MAIUSCULAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITOS = "23456789";
const SIMBOLOS = "!@#$%&*?+-_=";

export interface PassOpts {
  length: number;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

/**
 * Senha a partir de `crypto.getRandomValues`, nunca de `Math.random`.
 *
 * Usa amostragem por rejeição: descartar os valores do topo do intervalo evita
 * o viés de módulo, em que os primeiros caracteres do alfabeto sairiam com
 * frequência ligeiramente maior que os outros.
 */
export function generatePassword(opts: PassOpts): string {
  const tamanho = Math.min(128, Math.max(6, opts.length));
  let alfabeto = MINUSCULAS;
  if (opts.upper) alfabeto += MAIUSCULAS;
  if (opts.digits) alfabeto += DIGITOS;
  if (opts.symbols) alfabeto += SIMBOLOS;

  const limite = Math.floor(0x1_0000_0000 / alfabeto.length) * alfabeto.length;
  const saida: string[] = [];
  const sorteio = new Uint32Array(1);
  while (saida.length < tamanho) {
    crypto.getRandomValues(sorteio);
    if (sorteio[0] < limite) saida.push(alfabeto[sorteio[0] % alfabeto.length]);
  }
  return saida.join("");
}
