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
- Vulnerabilities in the server functions under `api/` — in particular, any way
  to bypass the per-IP rate limit, call the Groq API without going through it,
  or make the Telegram webhook act without a valid secret

## What is not in scope

- **`src/components/DomainGuard.tsx` being removable.** It pins a build to a set
  of hostnames as a convenience. With the source public it is trivially
  bypassed, and it is not intended as a security control.
- **Calling `/api/transcribe` or `/api/tts` from a script.** The same-origin
  check only stops other websites from using the functions through a visitor's
  browser; a script can send any `Origin` it likes. What protects the service is
  the per-IP rate limit, so reports belong there.
- Missing rate limits on a self-hosted install you configured yourself.
- Reports produced only by an automated scanner, with no demonstrated impact.

## A note for people self-hosting

The Docker image ships a deliberately strict CSP that allows no third-party
origins, and does not include the server functions — the audio tools show a
notice there instead. Please keep the policy that strict rather than widening
it.
