# Contributing

Thanks for being here. This is a small project with a clear shape, so the rules
are short.

Português: as issues e os pull requests podem ser em português ou em inglês, o
que for mais confortável para você.

## Ground rules of the project

Two decisions are not up for negotiation, because they are the reason the
project exists:

1. **Processing stays on the user's machine.** Never add a dependency that
   uploads user files, media or text to an API, a backend or a cloud service —
   not even when it would solve a hard problem more easily or with better
   quality. Prefer WebAssembly, Web APIs and Workers. If a feature is genuinely
   impossible without a server, say so plainly in the issue and let the
   maintainer decide; do not add the remote call.
2. **A conversion must be faithful.** The output should be the same document in
   a different format. Never offer a degraded mode as a first-class option —
   "text only", "simplified", "without images". If the result loses content,
   that is a bug to fix, not a checkbox to add.

## Getting set up

```sh
npm install
npm run dev      # http://localhost:7767
```

Before opening a pull request:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs all four on Node 20 and 22.

## Code style

- **Comments are written in Portuguese and explain *why*, not *what*.** The code
  already says what it does; the comment exists for the decision behind it — the
  bug that forced it, the alternative that was rejected, the constraint that is
  not obvious. Please keep this, it is what makes the project maintainable.
- TypeScript everywhere, no `any` unless there is a comment justifying it.
- Match the surrounding code: naming, structure, comment density.
- Pure logic goes in `src/lib/`, with unit tests in `src/test/`. Anything that
  touches the DOM, canvas or a worker goes in the component or in a script that
  can run in a real browser.

## Testing conversion work

The conversion engines have a verification harness rather than eyeballing:

```sh
node scripts/diagnostico-pdf-docx.mjs input.pdf output.docx
node scripts/diagnostico-docx.mjs input.docx
```

They run the real engine inside a headless Chromium via Playwright, so what you
measure is what the site does. If you change a converter, show a before/after in
the pull request.

## Keep it at zero external requests

A default install fetches nothing from a third party, and that is enforced by
the Content-Security-Policy in `docker/nginx.conf`, not just by good intentions.
If a change of yours needs a new external origin, it will fail in the browser
and in CI — that is the alarm working, not a misconfiguration to widen. Vendor
the asset instead, the way `public/fonts/` and `public/ffmpeg/` already are.

## Good first issues

- **OCR for scanned PDFs**, locally via WebAssembly, so that image-only PDFs can
  become Word documents.
- **Borderless table detection** in `src/lib/pdf-to-docx/tables.ts` — today only
  ruled tables are recovered in untagged PDFs.
- **A text layer in the Word → PDF converter**, so the generated PDF is
  searchable and can be converted back.

## Reporting bugs

Include the input file if you can share it, the browser and version, and what
you expected versus what happened. For conversion bugs, the original file plus
the wrong output tells us more than any description.

Security issues go to [SECURITY.md](SECURITY.md), not to public issues.
