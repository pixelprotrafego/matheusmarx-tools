-- Restrict direct API/RPC access to SECURITY DEFINER function has_role
-- while preserving its use inside RLS policies.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;