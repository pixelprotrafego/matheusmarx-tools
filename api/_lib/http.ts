/**
 * Utilidades HTTP comuns às funções em `api/`.
 *
 * As funções seguem a assinatura de Web Standards que a Vercel aceita no
 * runtime Node (`export function POST(req: Request): Response`). Isso mantém o
 * código igual ao que rodaria em qualquer plataforma que fale `Request` e
 * `Response`, sem amarrar nada a um SDK.
 */

/** Resposta JSON que nunca deve ir para cache. */
export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

/**
 * A chamada vem do próprio site, ou de fora de um navegador?
 *
 * As funções servem o site no mesmo domínio, então um `Origin` diferente do
 * host da requisição é outro site tentando usar a cota da Groq a partir do
 * navegador de um visitante. Isso é barrado aqui.
 *
 * Chamada sem `Origin` (curl, script, o próprio Telegram) passa: exigir o
 * cabeçalho não resolveria nada, porque quem chama por script escreve o valor
 * que quiser. Quem segura o custo de verdade é o limite por IP, em
 * `rate-limit.ts`; esta checagem é a camada contra o abuso via navegador alheio.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * IP de quem chamou, para o limite por IP.
 *
 * A ordem é questão de segurança, não de gosto. Na Vercel, `x-real-ip` é
 * escrito pela plataforma e sobrescreve o que o cliente mandar. O
 * `x-forwarded-for` é uma lista em que **quem chama controla o começo**: basta
 * enviar `X-Forwarded-For: 1.2.3.4` e o proxy acrescenta o IP real no fim. Por
 * isso, na falta de `x-real-ip`, vale o **último** item, nunca o primeiro.
 *
 * `cf-connecting-ip` ficou de fora de propósito. Ele só é confiável quando há
 * um Cloudflare na frente que o sobrescreva; sem isso, qualquer um manda o
 * cabeçalho com o valor que quiser e escapa do limite trocando de "IP" a cada
 * requisição.
 */
export function getClientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const partes = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (partes.length) return partes[partes.length - 1];
  }

  // Sem pista confiável, todos caem no mesmo balde. Restritivo de propósito:
  // melhor limitar demais do que abrir a torneira.
  return "unknown";
}

/** Mensagem legível de um erro qualquer, sem vazar objetos inteiros. */
export function errorMessage(e: unknown, fallback = "erro desconhecido"): string {
  return e instanceof Error ? e.message : fallback;
}
