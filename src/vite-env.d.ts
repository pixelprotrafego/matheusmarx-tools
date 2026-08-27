/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Hostnames onde a aplicação pode rodar, separados por vírgula.
   * Vazio/ausente desliga a trava de domínio (ver src/components/DomainGuard.tsx).
   * Um item iniciado por "." libera o domínio e seus subdomínios.
   */
  readonly VITE_ALLOWED_HOSTS?: string;

  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_PROJECT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
