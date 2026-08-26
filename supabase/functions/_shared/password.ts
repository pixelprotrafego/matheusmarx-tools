const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?+-_=";

export interface PassOpts {
  length: number;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

export function generatePassword(opts: PassOpts): string {
  const len = Math.min(128, Math.max(6, opts.length));
  let pool = LOWER;
  if (opts.upper) pool += UPPER;
  if (opts.digits) pool += DIGITS;
  if (opts.symbols) pool += SYMBOLS;
  const out: string[] = [];
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out.push(pool[arr[i] % pool.length]);
  return out.join("");
}