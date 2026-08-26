
REVOKE EXECUTE ON FUNCTION public.check_and_increment_ip_limit(text, text, int, int) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ip_limit(text, text, int, int) TO service_role;
