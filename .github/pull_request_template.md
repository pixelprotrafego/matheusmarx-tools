## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- The reasoning behind the approach, especially if you rejected an
     alternative. This is the part that ends up as a comment in the code. -->

## How it was verified

<!-- For conversion changes, attach a before/after: the input file and the
     output from each side. `scripts/diagnostico-pdf-docx.mjs` and
     `scripts/diagnostico-docx.mjs` produce these. -->

## Checklist

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes with no environment variables set
- [ ] No user file, media or text is sent to any server
- [ ] No degraded conversion mode was added as a user-facing option
- [ ] New comments explain *why*, in Portuguese, matching the surrounding code
