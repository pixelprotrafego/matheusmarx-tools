
CREATE TABLE public.telegram_pending_files (
  key text PRIMARY KEY,
  chat_id bigint NOT NULL,
  file_id text NOT NULL,
  mime text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_pending_files TO service_role;
ALTER TABLE public.telegram_pending_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_public_access_files" ON public.telegram_pending_files FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE INDEX idx_telegram_pending_files_created ON public.telegram_pending_files (created_at);

CREATE TABLE public.telegram_pending_actions (
  chat_id bigint PRIMARY KEY,
  op text NOT NULL,
  file_id text NOT NULL,
  mime text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.telegram_pending_actions TO service_role;
ALTER TABLE public.telegram_pending_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "no_public_access_actions" ON public.telegram_pending_actions FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE INDEX idx_telegram_pending_actions_created ON public.telegram_pending_actions (created_at);
