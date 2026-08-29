# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/pixelprotrafego/matheusmarx-tools/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with
it. You will get a first reply within 7 days. If a fix is needed, it ships in a
patch release and you are credited in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release on `main` receives fixes. This is a browser application
with no long-lived deployments to support, so upgrading means pulling the latest
image or rebuilding.

## What is in scope

- Cross-site scripting through a crafted input file (a PDF, DOCX, SVG or image
  that executes script when opened by a tool)
- Bypasses of the Content-Security-Policy in `vercel.json` or `docker/nginx.conf`
- Any path where user file content leaves the browser without being one of the
  documented exceptions
- Vulnerabilities in the Supabase edge functions under `supabase/functions/`

## What is not in scope

- **`src/components/DomainGuard.tsx` being removable.** It pins a build to a set
  of hostnames as a convenience. With the source public it is trivially
  bypassed, and it is not intended as a security control.
- **The Supabase publishable (anon) key being visible.** That key is designed to
  be public and is embedded in every frontend build. Access control lives in the
  edge functions and in row-level security.
- Missing rate limits on a self-hosted install you configured yourself.
- Reports produced only by an automated scanner, with no demonstrated impact.

## A note for people self-hosting

The Docker image ships a deliberately strict CSP that allows no third-party
origins. If you enable the Audio & Voice tools, you must add your Supabase
domain to `connect-src` in `docker/nginx.conf` — please add only that domain,
rather than widening the policy.
