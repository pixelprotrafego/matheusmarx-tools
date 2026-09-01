# Matheus Marx Tools

**A toolbox for everyday file work — PDF, Office, images, audio and video — that runs entirely inside your browser.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![CI](https://github.com/pixelprotrafego/matheusmarx-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/pixelprotrafego/matheusmarx-tools/actions/workflows/ci.yml)

Live instance: <https://tools.matheusmarx.com.br/> · [Leia em português](README.pt-BR.md)

---

## Why another converter

Most "free online converters" work the same way: you upload your file to a
server you know nothing about, it comes back converted, and you hope it was
deleted. For a contract, a medical report or an ID scan, that is a bad trade.

This one never uploads anything. Conversion, editing and OCR-free text
extraction all happen in the tab, using WebAssembly and browser APIs. You can
disconnect from the internet after the page loads and everything still works.

That is also why it can be self-hosted in one command — there is no backend to
host.

## Tools

| Group | What it does |
| --- | --- |
| **File & media conversion** | PDF ↔ DOCX/XLSX, HEIC/WEBP/AVIF, GIF → MP4, MP4/MKV/WEBM, MP3/WAV/FLAC/OPUS, CSV ↔ JSON ↔ YAML |
| **PDF tools** | Merge, split, rotate, compress, watermark, reorder, flatten, extract images |
| **Image & video editing** | Resize, compress, remove background, crop, join, extract frames and audio |
| **Notepad & drawing** | Rich-text notepad and a freehand drawing board |
| **Calculator & units** | Scientific calculator and unit converter |
| **Privacy & utilities** | QR codes, passwords, hashes, Base64, JSON, metadata scrubbing, steganography |
| **Audio & voice** ⚠️ | Speech-to-text and text-to-speech — *the only tools that need a server* |

The PDF ↔ Word converters are the ones under the most active development: they
reconstruct fonts, colours, alignment, lists, tables, headers and footers rather
than dumping plain text.

## Quick start

### Docker (recommended for self-hosting)

```sh
git clone https://github.com/pixelprotrafego/matheusmarx-tools.git
cd matheusmarx-tools
docker compose up -d
```

Open <http://localhost:7767>.

The image is a static file server and nothing else — no database, no volumes, no
state. It ships the ~31 MB ffmpeg WebAssembly engine inside, so video tools work
with no internet connection at all.

```sh
docker compose down          # stop
docker compose up -d --build # rebuild after pulling changes
```

### From source

Requires **Node.js 20.19+ or 22.12+** (what Vite 8 needs).

```sh
npm install
npm run dev      # http://localhost:7767
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest |

## Configuration

**Everything is optional.** Copy `.env.example` to `.env` only if you need one
of these.

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | empty | Enables the two Audio & Voice tools |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | empty | Same |
| `VITE_SUPABASE_PROJECT_ID` | empty | Same |
| `VITE_ALLOWED_HOSTS` | empty (off) | Comma-separated hostnames the app is allowed to run on. `localhost` is always allowed |

There is no analytics variable, because there is no analytics. See below.

Vite bakes these into the bundle at **build** time, not at run time. In Docker
they are build args; see `docker-compose.yml`.

## The one exception to "everything is local"

Speech-to-text and text-to-speech cannot run in the browser at acceptable
quality, so they call Supabase edge functions in `supabase/functions/`, which in
turn call the Groq API (Whisper and Orpheus).

**Without Supabase configured, those two tools show a message explaining they are
disabled. Nothing else is affected.** If you want them, you need your own
Supabase project:

| Secret | Where | What for |
| --- | --- | --- |
| `GROQ_API_KEY` | Supabase | Groq API access |
| `ALLOWED_ORIGINS` | Supabase | Origins allowed to call the functions. Empty disables the check |
| `TELEGRAM_BOT_TOKEN` | Supabase | Optional Telegram bot |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Supabase | Chat ids allowed to use the bot. Empty means nobody |

The database stores only disposable data: per-IP rate-limit counters and files
awaiting a Telegram action, both expiring within minutes. No user content is
ever stored.

## Honest privacy notes

**A default self-hosted install makes zero external requests.** Not "almost
zero" — the Docker image ships a Content-Security-Policy that allows no
third-party origin at all, so any attempt to reach one fails visibly instead of
happening quietly. This is verified on every push by the CI smoke test.

What that took, and what it means for you:

- **Fonts** (Sora and DM Sans) are served from `/fonts/` on your own domain.
  They used to come from Google Fonts, which handed every visitor's IP to Google
  on every page load. They are variable-weight `woff2` files, ~104 KB in total,
  licensed under the SIL Open Font License 1.1 (see `public/fonts/`).
- **ffmpeg** is served from your own domain too. `unpkg`/`jsdelivr` remain in the
  code only as a fallback if that copy is missing, and the Docker CSP blocks
  them, so a missing copy fails loudly rather than phoning out.
- **There is no analytics.** Not "off by default" — absent. No tracker ships in
  this code, and none runs on the official site either. There used to be a Meta
  Pixel on the official deployment; it was removed, along with the Meta origins
  that used to be allowed in the CSP. It is still visible in the git history,
  where a pixel id is harmless: that id is public by design, printed in the HTML
  of every page that runs one.
- **Audio & voice** send audio and text to a server, as described above. They
  are visibly marked and disabled by default.

Everything else — every conversion, every PDF operation, every image and video
edit — happens in the tab and touches no network.

## Self-hosting a fork

If you deploy this on your own domain, edit `index.html` and replace the
`og:url`, `og:image`, `twitter:image`, `canonical` and the two JSON-LD blocks,
which point at the official instance. Also review the `Content-Security-Policy`
in `docker/nginx.conf` (self-hosted) or `vercel.json` (Vercel).

`src/components/DomainGuard.tsx` can pin a build to specific hostnames via
`VITE_ALLOWED_HOSTS`. It is a convenience for the official deployment, not a
security control — with the source public, anyone can remove it.

## Architecture

- **Vite** + **React 18** + **TypeScript**, no server-side rendering
- **Tailwind CSS** + **shadcn/ui** (Radix)
- **pdf.js** / **pdf-lib** — reading and manipulating PDF
- **docx**, **docx-preview**, **SheetJS** — Office formats
- **ffmpeg.wasm** — audio and video
- **fabric** — drawing board · **TipTap** — rich-text editor
- **@imgly/background-removal** — background removal via a local model

The PDF → Word engine lives in `src/lib/pdf-to-docx/` and is documented
module by module; `scripts/diagnostico-pdf-docx.mjs` runs it in a real Chromium
and writes the resulting `.docx` for inspection.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Source comments are written in Portuguese and explain *why* a decision was made;
please keep that habit. To report a security problem, read
[SECURITY.md](SECURITY.md).

## License

[GNU Affero General Public License v3.0 or later](LICENSE).

This is not a stylistic choice. The project depends on
`@imgly/background-removal` (AGPL-3.0) and `@ffmpeg/core` (GPL-2.0-or-later), so
the combined work must be AGPL. In practice it means: use it, change it, host it
— but if you run a modified version as a public service, publish your changes
too.

See [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) for the full dependency
breakdown.
