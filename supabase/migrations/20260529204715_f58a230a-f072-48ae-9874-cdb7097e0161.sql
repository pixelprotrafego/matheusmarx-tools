
CREATE TABLE public.ip_rate_limits (
  ip text NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, bucket, window_start)
);

GRANT ALL ON public.ip_rate_limits TO service_role;

ALTER TABLE public.ip_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "no_public_access_rate_limits"
ON public.ip_rate_limits
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

CREATE INDEX idx_ip_rate_limits_cleanup ON public.ip_rate_limits (window_start);

-- Atomic check + increment for both hourly and daily windows.
CREATE OR REPLACE FUNCTION public.check_and_increment_ip_limit(
  _ip text,
  _bucket text,
  _hourly int,
  _daily int
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
  -- Cleanup old windows opportunistically (older than 25h).
  DELETE FROM public.ip_rate_limits WHERE window_start < now() - interval '25 hours';

  -- Hourly bucket
  INSERT INTO public.ip_rate_limits (ip, bucket, window_start, count)
  VALUES (_ip, _bucket || ':h', hour_start, 1)
  ON CONFLICT (ip, bucket, window_start)
  DO UPDATE SET count = public.ip_rate_limits.count + 1
  RETURNING count INTO hour_count;

  -- Daily bucket
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

REVOKE ALL ON FUNCTION public.check_and_increment_ip_limit(text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ip_limit(text, text, int, int) TO service_role;
