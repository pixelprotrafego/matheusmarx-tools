// Rate limit client-side em localStorage. Não é à prova de bala
// (usuário pode limpar storage), mas filtra abuso casual sem login.
// Janela deslizante simples por toolId.

const KEY = "mm:rl:v1";

type Hit = { t: number; tool: string };

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function read(): Hit[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Hit[];
    const cutoff = Date.now() - DAY;
    return arr.filter((h) => h.t > cutoff);
  } catch {
    return [];
  }
}

function write(hits: Hit[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(hits));
  } catch {
    // storage cheio/bloqueado — ignora silenciosamente
  }
}

export interface RateLimitResult {
  ok: boolean;
  remainingHour: number;
  remainingDay: number;
  resetInMs: number;
  reason?: "hour" | "day";
}

export interface RateLimitOptions {
  hourly: number;
  daily: number;
}

export function check(tool: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const hits = read().filter((h) => h.tool === tool);
  const lastHour = hits.filter((h) => h.t > now - HOUR);
  const lastDay = hits;

  if (lastHour.length >= opts.hourly) {
    const oldest = Math.min(...lastHour.map((h) => h.t));
    return {
      ok: false,
      remainingHour: 0,
      remainingDay: Math.max(0, opts.daily - lastDay.length),
      resetInMs: oldest + HOUR - now,
      reason: "hour",
    };
  }
  if (lastDay.length >= opts.daily) {
    const oldest = Math.min(...lastDay.map((h) => h.t));
    return {
      ok: false,
      remainingHour: Math.max(0, opts.hourly - lastHour.length),
      remainingDay: 0,
      resetInMs: oldest + DAY - now,
      reason: "day",
    };
  }
  return {
    ok: true,
    remainingHour: opts.hourly - lastHour.length,
    remainingDay: opts.daily - lastDay.length,
    resetInMs: 0,
  };
}

export function record(tool: string) {
  const hits = read();
  hits.push({ t: Date.now(), tool });
  write(hits);
}

/** Helper: checa e, se ok, já registra o uso. Retorna ok=false bloqueando a operação. */
export function consume(tool: string, opts: RateLimitOptions): RateLimitResult {
  const r = check(tool, opts);
  if (r.ok) record(tool);
  return r;
}

export function formatReset(ms: number): string {
  if (ms <= 0) return "agora";
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.ceil(min / 60);
  return `${h} h`;
}