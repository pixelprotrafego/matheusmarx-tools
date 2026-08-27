-- Esquema inicial do projeto.
--
-- Consolida as migrações herdadas do Supabase provisionado pela Lovable,
-- deixando de fora as tabelas `posts`, `user_roles`, o enum `app_role` e a
-- função `has_role`: eram um blog com administração que nunca teve tela na
-- aplicação e que nenhuma linha do código consulta.
--
-- Restam as três tabelas que as edge functions realmente usam. Todas negam
-- acesso via API pública (anon e authenticated) e são manipuladas apenas pelo
-- service_role, de dentro das functions.

-- ---------------------------------------------------------------------------
-- Limite de requisições por IP, usado por transcribe-audio e groq-tts.
-- ---------------------------------------------------------------------------

CREATE TABLE public.ip_rate_limits (
  ip           text        NOT NULL,
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, bucket, window_start)
);

GRANT ALL ON public.ip_rate_limits TO service_role;
ALTER TABLE public.ip_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_access_rate_limits"
  ON public.ip_rate_limits FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX idx_ip_rate_limits_cleanup ON public.ip_rate_limits (window_start);

-- Checa e incrementa as janelas horária e diária numa única ida ao banco, para
-- que duas requisições simultâneas não escapem do limite.
CREATE OR REPLACE FUNCTION public.check_and_increment_ip_limit(
  _ip     text,
  _bucket text,
  _hourly int,
  _daily  int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  hour_start timestamptz := date_trunc('hour', now());
  day_start  timestamptz := date_trunc('day',  now());
  hour_count int;
  day_count  int;
  reset_ms   bigint;
BEGIN
  -- Aproveita a chamada para descartar janelas velhas.
  DELETE FROM public.ip_rate_limits WHERE window_start < now() - interval '25 hours';

  INSERT INTO public.ip_rate_limits (ip, bucket, window_start, count)
  VALUES (_ip, _bucket || ':h', hour_start, 1)
  ON CONFLICT (ip, bucket, window_start)
  DO UPDATE SET count = public.ip_rate_limits.count + 1
  RETURNING count INTO hour_count;

  INSERT INTO public.ip_rate_limits (ip, bucket, window_start, count)
  VALUES (_ip, _bucket || ':d', day_start, 1)
  ON CONFLICT (ip, bucket, window_start)
  DO UPDATE SET count = public.ip_rate_limits.count + 1
  RETURNING count INTO day_count;

  IF hour_count > _hourly THEN
    reset_ms := EXTRACT(EPOCH FROM ((hour_start + interval '1 hour') - now())) * 1000;
    RETURN jsonb_build_object('ok', false, 'reset_in_ms', reset_ms, 'scope', 'hourly');
  END IF;

  IF day_count > _daily THEN
    reset_ms := EXTRACT(EPOCH FROM ((day_start + interval '1 day') - now())) * 1000;
    RETURN jsonb_build_object('ok', false, 'reset_in_ms', reset_ms, 'scope', 'daily');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL     ON FUNCTION public.check_and_increment_ip_limit(text, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_and_increment_ip_limit(text, text, int, int) TO service_role;

-- ---------------------------------------------------------------------------
-- Bot do Telegram: arquivos recebidos aguardando a escolha de uma ação.
-- Guarda só o file_id do Telegram, nunca o conteúdo do arquivo.
-- ---------------------------------------------------------------------------

CREATE TABLE public.telegram_pending_files (
  key        text        PRIMARY KEY,
  chat_id    bigint      NOT NULL,
  file_id    text        NOT NULL,
  mime       text        NOT NULL DEFAULT '',
  filename   text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.telegram_pending_files TO service_role;
ALTER TABLE public.telegram_pending_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_access_files"
  ON public.telegram_pending_files FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX idx_telegram_pending_files_created ON public.telegram_pending_files (created_at);

-- ---------------------------------------------------------------------------
-- Bot do Telegram: ação aguardando um dado que o usuário ainda vai digitar,
-- como o intervalo de páginas ou a largura da imagem. Uma por conversa.
-- ---------------------------------------------------------------------------

CREATE TABLE public.telegram_pending_actions (
  chat_id    bigint      PRIMARY KEY,
  op         text        NOT NULL,
  file_id    text        NOT NULL,
  mime       text        NOT NULL DEFAULT '',
  filename   text        NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.telegram_pending_actions TO service_role;
ALTER TABLE public.telegram_pending_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_access_actions"
  ON public.telegram_pending_actions FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX idx_telegram_pending_actions_created ON public.telegram_pending_actions (created_at);
