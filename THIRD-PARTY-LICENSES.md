# Third-party licenses

This project is distributed under the [AGPL-3.0-or-later](LICENSE). That choice
is forced by two dependencies, listed first below.

Run `npm ls` for the complete tree; what follows covers everything that ships in
the browser bundle or in the Docker image.

## Copyleft dependencies (these determine the project licence)

| Package | Licence | Notes |
| --- | --- | --- |
| `@imgly/background-removal` | **AGPL-3.0** | Used by the background-removal tool. AGPL is triggered by *network use*, so any public deployment must offer its source. IMG.LY sells commercial exceptions if you need one. |
| `@ffmpeg/core` | **GPL-2.0-or-later** | The ffmpeg WebAssembly build. Not committed to this repository — `scripts/copy-ffmpeg-core.mjs` copies it out of `node_modules` at build time — but it *is* redistributed inside the Docker image and in any deployed `dist/`. GPL-2.0-or-later is upgradeable to GPL-3.0, which is compatible with AGPL-3.0. |

Removing both would allow a permissive licence, at the cost of the
background-removal tool and of swapping the video engine for an LGPL build.

## Permissive dependencies

| Package | Licence |
| --- | --- |
| `react`, `react-dom`, `react-router-dom` | MIT |
| `@ffmpeg/ffmpeg`, `@ffmpeg/util` | MIT |
| `@cantoo/pdf-lib`, `@cantoo/fontkit`, `fflate`, `jspdf` | MIT |
| `svg2pdf.js` and its dependencies `cssesc`, `font-family-papandreou`, `specificity`, `svgpath` | MIT |
| `docx` | MIT |
| `fabric` | MIT |
| `html2canvas` (pulled in by `jspdf` as an optional dependency) | MIT |
| `heic2any` | MIT |
| `turndown` | MIT |
| `marked` | MIT |
| `qrcode` | MIT |
| `js-yaml` | MIT |
| `jszip` | MIT / GPL-3.0 (dual) |
| `file-saver` | MIT |
| `@tiptap/*` | MIT |
| `@radix-ui/*`, `shadcn/ui` | MIT |
| `tailwindcss`, `tailwindcss-animate` | MIT |
| `@tanstack/react-query` | MIT |
| `sonner` | MIT |
| `lucide-react` | ISC |
| `class-variance-authority`, `clsx`, `tailwind-merge` | MIT |
| `next-themes` | MIT |
| `@upstash/redis` (server only) | MIT |
| `unpdf`, `jimp` (server only) | MIT |
| `mammoth` (server only) | BSD-2-Clause |
| `pdfjs-dist` | Apache-2.0 |
| `xlsx` (SheetJS) | Apache-2.0 |
| `@jsquash/avif` (AVIF encoder, WebAssembly, loaded only when the browser cannot encode AVIF itself) and its dependency `wasm-feature-detect` | Apache-2.0 |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `imagetracerjs` | Unlicense |

## Assets and services

| Item | Notes |
| --- | --- |
| **Sora** (v17) | SIL Open Font License 1.1. Bundled in `public/fonts/`, served from the application's own domain. Licence text: `public/fonts/OFL-Sora.txt`. |
| **DM Sans** (v17) | SIL Open Font License 1.1. Bundled in `public/fonts/`. Licence text: `public/fonts/OFL-DMSans.txt`. |
| **Carlito** | SIL Open Font License 1.1, Reserved Font Name "Carlito". Metric-compatible with Calibri. Bundled **unmodified** in `public/fonts/docx/` (files renamed only) for the Word-to-PDF converter. Licence text: `public/fonts/docx/OFL-Carlito.txt`. |
| **Caladea** | SIL Open Font License 1.1. Metric-compatible with Cambria. Bundled unmodified in `public/fonts/docx/`. Licence text: `public/fonts/docx/OFL-Caladea.txt`. |
| **Liberation Sans, Serif, Mono** (2.1.5) | SIL Open Font License 1.1, Reserved Font Name "Liberation". Metric-compatible with Arial, Times New Roman and Courier New. Bundled **unmodified** in `public/fonts/docx/`. Licence text: `public/fonts/docx/LICENSE-Liberation.txt`. |
| **DejaVu Sans** (2.37), symbols subset | Bitstream Vera licence plus public-domain DejaVu changes. Subsetted to the symbol ranges used as a fallback (`dejavu-symbols.ttf`); the licence allows modified copies as long as the name contains neither "Bitstream" nor "Vera" (it keeps "DejaVu Sans"). Licence text: `public/fonts/docx/LICENSE-DejaVu.txt`. |
| **Groq API** (Whisper, Orpheus) | Third-party service, called only by the server functions in `api/` for the two Audio & Voice tools and the Telegram bot, and only when you configure your own credentials. |
| **Upstash Redis** | Third-party service holding only short-lived rate-limit counters and bot state, when you configure it. |

The OFL allows bundling and redistributing the fonts, including inside this
repository and the Docker image, as long as the licence travels with them and
they are not sold on their own. Every licence file sits next to its fonts and
is served alongside them.

The Word-to-PDF converter serves Carlito and Liberation exactly as published,
because a modified copy (a subset, for instance) could not keep a Reserved Font
Name. It embeds a subset of each font in the PDFs it produces, which the OFL
permits for documents; the vertical-metrics adjustment it applies for layout is
made on an in-memory copy in the user's browser and is never redistributed.

## A note on `xlsx`

SheetJS is installed straight from `https://cdn.sheetjs.com/...` rather than from
the npm registry, because the project stopped publishing there. It is still
Apache-2.0. The practical consequence is that `npm ci` and the Docker build need
network access to that host, and `npm audit` cannot see the package.
