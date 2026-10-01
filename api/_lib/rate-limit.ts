import { getClientIp } from "./http.js";
import { getStore } from "./store.js";

export interface RateLimitResult {
  ok: boolean;
  resetInMs?: number;
  scope?: "hourly" | "daily";
}

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

/** Segundos até o fim da janela, com folga para o relógio não cortar antes da hora. */
const ttlAte = (fim: number, agora: number) => Math.ceil((fim - agora) / 1000) + 60;

/**
 * Limite por IP em duas janelas fixas, uma por hora e uma por dia, em UTC.
 *
 * As duas contam a cada chamada e a horária é conferida primeiro — o mesmo
 * comportamento da função SQL que existia antes, para quem usa não notar
 * diferença. Cada janela é uma chave própria, que o Redis apaga sozinho quando
 * ela acaba.
 *
 * Falha de infraestrutura deixa passar, em vez de derrubar a ferramenta: uma
 * queda do Redis não deve tirar a transcrição do ar.
 */
export async function checkIpLimit(
  req: Request,
  bucket: string,
  hourly: number,
  daily: number,
  agora: number = Date.now(),
): Promise<RateLimitResult> {
  const ip = getClientIp(req);
  const inicioHora = Math.floor(agora / HORA) * HORA;
  const inicioDia = Math.floor(agora / DIA) * DIA;

  try {
    const store = getStore();
    const [naHora, noDia] = await Promise.all([
      store.incr(`rl:${bucket}:h:${ip}:${inicioHora}`, ttlAte(inicioHora + HORA, agora)),
      store.incr(`rl:${bucket}:d:${ip}:${inicioDia}`, ttlAte(inicioDia + DIA, agora)),
    ]);

    if (naHora > hourly) return { ok: false, resetInMs: inicioHora + HORA - agora, scope: "hourly" };
    if (noDia > daily) return { ok: false, resetInMs: inicioDia + DIA - agora, scope: "daily" };
    return { ok: true };
  } catch (e) {
    console.error("[rate-limit] falha no armazenamento, liberando:", e);
    return { ok: true };
  }
}
