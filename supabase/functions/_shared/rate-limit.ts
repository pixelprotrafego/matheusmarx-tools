import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
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

const ALLOWED_ORIGINS = [
  "https://tools.matheusmarx.com.br",
  "https://matheusmarxtools.lovable.app",
];
const ALLOWED_ORIGIN_SUFFIXES = [".lovable.app", ".lovable.dev"];

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // server-to-server, no browser context
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_SUFFIXES.some((s) => host.endsWith(s));
  } catch {
    return false;
  }
}