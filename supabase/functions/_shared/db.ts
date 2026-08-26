import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

let _client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (_client) return _client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url) throw new Error("SUPABASE_URL ausente");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}