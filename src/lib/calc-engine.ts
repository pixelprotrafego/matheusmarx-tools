// Lightweight expression evaluator (shunting-yard) — no eval, no deps.
// Supports: + - * / ^ %, unary -, parentheses, functions, constants, factorial (!)

export type AngleMode = "deg" | "rad";

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

const toRad = (x: number, mode: AngleMode) => (mode === "deg" ? (x * Math.PI) / 180 : x);
const fromRad = (x: number, mode: AngleMode) => (mode === "deg" ? (x * 180) / Math.PI : x);

const factorial = (n: number): number => {
  if (n < 0 || !Number.isInteger(n)) throw new Error("fatorial inválido");
  if (n > 170) return Infinity;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
};

const makeFunctions = (mode: AngleMode): Record<string, (x: number) => number> => ({
  sin: (x) => Math.sin(toRad(x, mode)),
  cos: (x) => Math.cos(toRad(x, mode)),
  tan: (x) => Math.tan(toRad(x, mode)),
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
  | { t: "rp" }
  | { t: "comma" };

const PRECEDENCE: Record<string, number> = {
  "+": 1, "-": 1, "*": 2, "/": 2, "mod": 2, "^": 4, "u-": 5, "!": 6,
};
const RIGHT_ASSOC = new Set(["^", "u-"]);

function tokenize(expr: string, fnNames: Set<string>): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = expr.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/π/g, "pi");
  let prev: Tok | undefined;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: "num", v: parseFloat(s.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z]/.test(c)) {
      // Só letras: os espaços já foram removidos, então aceitar dígitos aqui
      // faria "10 mod 3" virar o identificador "mod3".
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (name === "mod") out.push({ t: "op", v: "mod" });
      else if (fnNames.has(name)) out.push({ t: "fn", v: name });
      else if (name in CONSTANTS) out.push({ t: "num", v: CONSTANTS[name] });
      else throw new Error(`Identificador desconhecido: ${name}`);
      i = j;
    } else if (c === "(") { out.push({ t: "lp" }); i++; }
    else if (c === ")") { out.push({ t: "rp" }); i++; }
    else if (c === ",") { out.push({ t: "comma" }); i++; }
    else if ("+-*/^!%".includes(c)) {
      if (c === "-" && (!prev || prev.t === "op" || prev.t === "lp" || prev.t === "comma")) {
        out.push({ t: "op", v: "u-" });
      } else if (c === "%") {
        // treat % as "divide by 100" postfix → multiply prior by 0.01
        out.push({ t: "op", v: "*" });
        out.push({ t: "num", v: 0.01 });
      } else {
        out.push({ t: "op", v: c });
      }
      i++;
    } else {
      throw new Error(`Caractere inválido: ${c}`);
    }
    prev = out[out.length - 1];
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
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "fn") { output.push(stack.pop()!); continue; }
        if (top.t === "op") {
          const pt = PRECEDENCE[top.v], pc = PRECEDENCE[tok.v];
          if (pt > pc || (pt === pc && !RIGHT_ASSOC.has(tok.v))) { output.push(stack.pop()!); continue; }
        }
        break;
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
      if (tok.v === "u-") {
        const a = eval_.pop();
        if (a === undefined) throw new Error("Expressão inválida");
        eval_.push(-a);
      } else if (tok.v === "!") {
        const a = eval_.pop();
        if (a === undefined) throw new Error("Expressão inválida");
        eval_.push(factorial(a));
      } else {
        const b = eval_.pop(), a = eval_.pop();
        if (a === undefined || b === undefined) throw new Error("Expressão inválida");
        switch (tok.v) {
          case "+": eval_.push(a + b); break;
          case "-": eval_.push(a - b); break;
          case "*": eval_.push(a * b); break;
          case "/": eval_.push(a / b); break;
          case "^": eval_.push(Math.pow(a, b)); break;
          case "mod": eval_.push(a % b); break;
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

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "Erro";
  if (Math.abs(n) >= 1e15 || (Math.abs(n) > 0 && Math.abs(n) < 1e-9)) return n.toExponential(8);
  // Trim trailing zeros, max 12 significant digits
  const s = parseFloat(n.toPrecision(12)).toString();
  return s;
}