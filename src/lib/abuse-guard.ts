// Gate único combinando detecção de bot + rate limit + honeypot.
// Substitui chamadas diretas a `consume()` nas ferramentas pesadas.

import { consume, type RateLimitOptions, type RateLimitResult } from "./rate-limit";
import { isLikelyBot } from "./bot-detect";

export type GuardResult = Omit<RateLimitResult, "reason"> & {
  reason?: "hour" | "day" | "bot" | "honeypot";
};

export function guard(tool: string, opts: RateLimitOptions): GuardResult {
  if (isLikelyBot()) {
    return { ok: false, remainingHour: 0, remainingDay: 0, resetInMs: 0, reason: "bot" };
  }
  return consume(tool, opts);
}

/** Mensagem amigável (mas vaga, pra não ensinar o bot). */
export function guardMessage(r: GuardResult): string {
  if (r.reason === "bot") return "Acesso bloqueado por motivo de segurança.";
  if (r.reason === "honeypot") return "Submissão inválida.";
  return "Limite de uso atingido. Tente novamente mais tarde.";
}