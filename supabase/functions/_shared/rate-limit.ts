import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * IP de quem chamou, para o limite por IP.
 *
 * A ordem aqui é uma questão de segurança, não de preferência. `x-forwarded-for`
 * é uma lista que cresce da esquerda para a direita, e **quem chama controla o
 * começo dela**: basta mandar `X-Forwarded-For: 1.2.3.4` e a plataforma
 * acrescenta o IP real no fim. Ler o primeiro item, como se fazia antes,
 * entregava a cota inteira a quem soubesse trocar um cabeçalho — um laço com
 * IPs falsos diferentes nunca esbarraria no limite, e cada requisição custa uma
 * chamada paga à Groq.
 *
 * Por isso vem primeiro o `cf-connecting-ip`, que o Cloudflare à frente do
 * Supabase escreve e sobrescreve, e que quem chama não consegue forjar. Sem ele,
 * usa-se o **último** item do `x-forwarded-for`, que é o que foi acrescentado
 * pelo proxy mais próximo e não pelo cliente.
 */
export function getClientIp(req: Request): string {
  const trusted = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (trusted) return trusted.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  // Sem nenhuma pista confiável, todos caem no mesmo balde. É restritivo de
  // propósito: melhor limitar demais do que abrir a torneira.
  return "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  resetInMs?: number;
  scope?: "hourly" | "daily";
}

let _client: ReturnType<typeof createClient> | null = null;
function svc() {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase env não configurada");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export async function checkIpLimit(
  req: Request,
  bucket: string,
  hourly: number,
  daily: number,
): Promise<RateLimitResult> {
  const ip = getClientIp(req);
  try {
    const { data, error } = await svc().rpc("check_and_increment_ip_limit", {
      _ip: ip,
      _bucket: bucket,
      _hourly: hourly,
      _daily: daily,
    });
    if (error) {
      console.error("rate-limit rpc error:", error);
      return { ok: true }; // fail-open to avoid breaking the app on infra glitch
    }
    const d = data as { ok: boolean; reset_in_ms?: number; scope?: "hourly" | "daily" };
    return { ok: d.ok, resetInMs: d.reset_in_ms, scope: d.scope };
  } catch (e) {
    console.error("rate-limit exception:", e);
    return { ok: true };
  }
}

// Origens autorizadas a chamar as edge functions, configuradas pelo secret
// ALLOWED_ORIGINS (lista separada por vírgula). Um item iniciado por "."
// libera o domínio e seus subdomínios, ex: ".matheusmarx.com.br".
//
// Enquanto o secret não estiver definido a checagem fica desligada, para o
// deploy de preview funcionar em domínio provisório. Defina-o ao publicar no
// domínio definitivo:
//
//   supabase secrets set ALLOWED_ORIGINS=https://tools.matheusmarx.com.br
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim().toLowerCase())
  .filter(Boolean);

// ATENÇÃO ao alcance real desta checagem: ela impede que **um site de terceiro**
// use estas functions a partir do navegador, porque aí o navegador é obrigado a
// enviar o cabeçalho `Origin` e ele não bate. Ela NÃO impede uma chamada por
// script (curl, Python, etc.), que simplesmente não envia `Origin` nenhum e cai
// no caso liberado abaixo.
//
// Exigir `Origin` sempre não resolveria — quem chama por script forja o valor
// que quiser. Portanto, quem de fato segura o custo destas functions é o limite
// por IP, e não esta função. Vale como camada extra, não como tranca.
export function isAllowedOrigin(req: Request): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true; // checagem desligada
  const origin = req.headers.get("origin");
  if (!origin) return true; // server-to-server, sem contexto de navegador
  const normalized = origin.toLowerCase();
  if (ALLOWED_ORIGINS.includes(normalized)) return true;
  try {
    const host = new URL(normalized).hostname;
    return ALLOWED_ORIGINS.some((a) => a.startsWith(".") && (host === a.slice(1) || host.endsWith(a)));
  } catch {
    return false;
  }
}