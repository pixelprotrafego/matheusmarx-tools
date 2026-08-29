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
| `pdf-lib`, `jspdf`, `jspdf-autotable` | MIT |
| `docx` | MIT |
| `fabric` | MIT |
| `html2canvas` | MIT |
| `heic2any` | MIT |
| `turndown` | MIT |
| `qrcode` | MIT |
| `js-yaml` | MIT |
| `jszip` | MIT / GPL-3.0 (dual) |
| `file-saver` | MIT |
| `@tiptap/*` | MIT |
| `@radix-ui/*`, `shadcn/ui` | MIT |
| `tailwindcss`, `tailwindcss-animate`, `@tailwindcss/typography` | MIT |
| `@tanstack/react-query` | MIT |
| `react-hook-form`, `@hookform/resolvers` | MIT |
| `zod` | MIT |
| `sonner` | MIT |
| `lucide-react` | ISC |
| `date-fns` | MIT |
| `class-variance-authority`, `clsx`, `tailwind-merge` | MIT |
| `next-themes` | MIT |
| `react-resizable-panels` | MIT |
| `@supabase/supabase-js` | MIT |
| `pdfjs-dist` | Apache-2.0 |
| `docx-preview` | Apache-2.0 |
| `xlsx` (SheetJS) | Apache-2.0 |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `imagetracerjs` | Unlicense |

## Assets and services

| Item | Notes |
| --- | --- |
| **Sora** (v17) | SIL Open Font License 1.1. Bundled in `public/fonts/`, served from the application's own domain. Licence text: `public/fonts/OFL-Sora.txt`. |
| **DM Sans** (v17) | SIL Open Font License 1.1. Bundled in `public/fonts/`. Licence text: `public/fonts/OFL-DMSans.txt`. |
| **Groq API** (Whisper, Orpheus) | Third-party service, used only by the two Audio & Voice tools and only when you configure your own credentials. |

The OFL allows bundling and redistributing the fonts, including inside this
repository and the Docker image, as long as the licence travels with them and
they are not sold on their own. Both licence files sit next to the `.woff2`
files and are served alongside them.

## A note on `xlsx`

SheetJS is installed straight from `https://cdn.sheetjs.com/...` rather than from
the npm registry, because the project stopped publishing there. It is still
Apache-2.0. The practical consequence is that `npm ci` and the Docker build need
network access to that host, and `npm audit` cannot see the package.
