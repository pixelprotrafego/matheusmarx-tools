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

  /**
   * Id numérico do Meta Pixel. Ausente/vazio = nenhum rastreador é carregado,
   * que é o padrão de quem clona o repositório (ver src/lib/analytics.ts).
   */
  readonly VITE_META_PIXEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
