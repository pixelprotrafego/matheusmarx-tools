import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const CONFIG_MISSING_MESSAGE =
  "As ferramentas de áudio precisam de VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY " +
  "definidas no ambiente de build. Todas as outras ferramentas funcionam sem isso.";

/** Diz se o build recebeu as variáveis, sem tentar criar o client. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

let client: SupabaseClient<Database> | null = null;

/**
 * O client é criado sob demanda, e não no import do módulo. `createClient`
 * lança quando a URL ou a chave faltam; feito no topo do arquivo, esse erro
 * derrubava o painel de Áudio & Voz inteiro antes de qualquer render — a tela
 * ficava vazia sem nenhuma mensagem.
 *
 * A aplicação não tem login: o client existe apenas para invocar as edge
 * functions de áudio, por isso a sessão não é persistida nem renovada.
 */
export function getSupabase(): SupabaseClient<Database> {
  if (client) return client;
  if (!isSupabaseConfigured()) throw new Error(CONFIG_MISSING_MESSAGE);
  client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return client;
}
