// Lightweight expression evaluator (shunting-yard) — no eval, no deps.
// Supports: + - * / ^ %, unary -, parentheses, functions, constants, factorial (!)

export type AngleMode = "deg" | "rad";

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const toRad = (x: number, mode: AngleMode) => (mode === "deg" ? (x * Math.PI) / 180 : x);
const fromRad = (x: number, mode: AngleMode) => (mode === "deg" ? (x * 180) / Math.PI : x);

/**
 * Quantos quartos de volta o ângulo tem, quando é um múltiplo exato de 90° (ou
 * de π/2): sen(180°) dá 0, e não 1,2e-16; tan(90°) não existe, em vez de
 * 1,6e16.
 */
function quarterTurns(x: number, mode: AngleMode): number | null {
  const q = mode === "deg" ? x / 90 : x / (Math.PI / 2);
  const r = Math.round(q);
  const exact = mode === "deg" ? q === r : Math.abs(q - r) < 1e-12;
  return exact && Number.isFinite(r) ? ((r % 4) + 4) % 4 : null;
}

const factorial = (n: number): number => {
  if (n < 0 || !Number.isInteger(n)) throw new Error("fatorial inválido");
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

const makeFunctions = (mode: AngleMode): Record<string, (x: number) => number> => ({
  sin: (x) => {
    const q = quarterTurns(x, mode);
    return q === null ? Math.sin(toRad(x, mode)) : [0, 1, 0, -1][q];
  },
  cos: (x) => {
    const q = quarterTurns(x, mode);
    return q === null ? Math.cos(toRad(x, mode)) : [1, 0, -1, 0][q];
  },
  tan: (x) => {
    const q = quarterTurns(x, mode);
    return q === null ? Math.tan(toRad(x, mode)) : q % 2 === 0 ? 0 : NaN;
  },
  asin: (x) => fromRad(Math.asin(x), mode),
  acos: (x) => fromRad(Math.acos(x), mode),
  atan: (x) => fromRad(Math.atan(x), mode),
  ln: (x) => Math.log(x),
  log: (x) => Math.log10(x),
  sqrt: Math.sqrt,
  exp: Math.exp,
  abs: Math.abs,
});

type Tok =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "fn"; v: string }
  | { t: "lp" }
  | { t: "rp" };

// O menos unário fica entre a multiplicação e a potência: -2^2 é -(2^2) = -4,
// como na notação matemática (antes dava 4). "!" e "%" são sufixos e pegam só
// o número à esquerda: 2^50% é 2^0,5.
const PRECEDENCE: Record<string, number> = {
  "+": 1, "-": 1, "*": 2, "/": 2, "mod": 2, "u-": 3, "^": 4, "!": 6, "%": 6,
};
const RIGHT_ASSOC = new Set(["^", "u-"]);
const POSTFIX = new Set(["!", "%"]);

/** Número com casas e expoente: 12, 0.5, .5, 1.5e-7 (como o próprio resultado sai). */
const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

function tokenize(expr: string, fnNames: Set<string>): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = expr
    .replace(/\s+/g, "")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, "pi")
    // Vírgula decimal, como se escreve no Brasil (nenhuma função tem dois argumentos).
    .replace(/,/g, ".");
  // Onde termina um valor, um valor seguido é multiplicação: 2π, 3(1+1), (2)(3).
  const endsValue = (t: Tok | undefined) => !!t && (t.t === "num" || t.t === "rp" || (t.t === "op" && POSTFIX.has(t.v)));
  const value = (tok: Tok) => {
    if (endsValue(out[out.length - 1])) out.push({ t: "op", v: "*" });
    out.push(tok);
  };
  while (i < s.length) {
    const c = s[i];
    const num = /[0-9.]/.test(c) ? NUMBER.exec(s.slice(i)) : null;
    if (num) {
      // "1.2.3" não é número (antes virava 1,2 calado).
      if (s[i + num[0].length] === ".") throw new Error("Número inválido");
      value({ t: "num", v: parseFloat(num[0]) });
      i += num[0].length;
    } else if (c === ".") {
      throw new Error("Número inválido");
    } else if (/[a-zA-Z]/.test(c)) {
      // Só letras: os espaços já foram removidos, então aceitar dígitos aqui
      // faria "10 mod 3" virar o identificador "mod3".
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (name === "mod") out.push({ t: "op", v: "mod" });
      else if (fnNames.has(name)) value({ t: "fn", v: name });
      else if (name in CONSTANTS) value({ t: "num", v: CONSTANTS[name] });
      else throw new Error(`Identificador desconhecido: ${name}`);
      i = j;
    } else if (c === "(") { value({ t: "lp" }); i++; }
    else if (c === ")") { out.push({ t: "rp" }); i++; }
    else if ("+-*/^!%".includes(c)) {
      const prev = out[out.length - 1];
      if (c === "-" && (!prev || prev.t === "lp" || (prev.t === "op" && !POSTFIX.has(prev.v)))) {
        out.push({ t: "op", v: "u-" });
      } else {
        out.push({ t: "op", v: c });
      }
      i++;
    } else {
      throw new Error(`Caractere inválido: ${c}`);
    }
  }
  return out;
}

export function evaluate(expr: string, mode: AngleMode = "deg"): number {
  const fns = makeFunctions(mode);
  const fnNames = new Set(Object.keys(fns));
  const tokens = tokenize(expr, fnNames);
  // Shunting-yard
  const output: Tok[] = [];
  const stack: Tok[] = [];
  for (const tok of tokens) {
    if (tok.t === "num") output.push(tok);
    else if (tok.t === "fn") stack.push(tok);
    else if (tok.t === "op") {
      // Operador prefixo vem antes do seu operando: não fecha nada da pilha
      // (senão 2^-2 tirava o "^" antes de ele ter os dois lados).
      if (tok.v !== "u-") {
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.t === "fn") { output.push(stack.pop()!); continue; }
          if (top.t === "op") {
            const pt = PRECEDENCE[top.v], pc = PRECEDENCE[tok.v];
            if (pt > pc || (pt === pc && !RIGHT_ASSOC.has(tok.v))) { output.push(stack.pop()!); continue; }
          }
          break;
        }
      }
      stack.push(tok);
    } else if (tok.t === "lp") stack.push(tok);
    else if (tok.t === "rp") {
      while (stack.length && stack[stack.length - 1].t !== "lp") output.push(stack.pop()!);
      if (!stack.length) throw new Error("Parêntese desbalanceado");
      stack.pop();
      if (stack.length && stack[stack.length - 1].t === "fn") output.push(stack.pop()!);
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.t === "lp" || top.t === "rp") throw new Error("Parêntese desbalanceado");
    output.push(top);
  }
  // Evaluate RPN
  const eval_: number[] = [];
  for (const tok of output) {
    if (tok.t === "num") eval_.push(tok.v);
    else if (tok.t === "fn") {
      const a = eval_.pop();
      if (a === undefined) throw new Error("Expressão inválida");
      eval_.push(fns[tok.v](a));
    } else if (tok.t === "op") {
      if (tok.v === "u-" || POSTFIX.has(tok.v)) {
        const a = eval_.pop();
        if (a === undefined) throw new Error("Expressão inválida");
        eval_.push(tok.v === "u-" ? -a : tok.v === "!" ? factorial(a) : a / 100);
      } else {
        const b = eval_.pop(), a = eval_.pop();
        if (a === undefined || b === undefined) throw new Error("Expressão inválida");
        switch (tok.v) {
          case "+": eval_.push(a + b); break;
          case "-": eval_.push(a - b); break;
          case "*": eval_.push(a * b); break;
          case "/": eval_.push(a / b); break;
          case "^": eval_.push(Math.pow(a, b)); break;
          // Resto com o sinal do divisor, como na matemática: -7 mod 3 = 2
          // (o % do JavaScript dava -1).
          case "mod": eval_.push(a - b * Math.floor(a / b)); break;
          default: throw new Error(`Operador desconhecido: ${tok.v}`);
        }
      }
    }
  }
  if (eval_.length !== 1) throw new Error("Expressão inválida");
  const r = eval_[0];
  if (!Number.isFinite(r)) throw new Error("Resultado inválido");
  return r;
}

/**
 * Resultado para exibir. Até 15 algarismos significativos, o que o double
 * guarda com certeza: some o ruído (0,1 + 0,2 dá 0,3), e um inteiro grande
 * como 123456789012345 sai inteiro (com 12 algarismos, o fim virava zeros).
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "Erro";
  if (Math.abs(n) >= 1e15 || (Math.abs(n) > 0 && Math.abs(n) < 1e-9)) {
    // Mantissa sem zeros à direita: 1e+20, e não 1.00000000e+20.
    const [m, exp] = n.toExponential(14).split("e");
    return `${parseFloat(m)}e${exp}`;
  }
  return String(parseFloat(n.toPrecision(15)));
}
