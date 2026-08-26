import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "pdf-vendor": ["pdf-lib", "pdfjs-dist"],
          "office-vendor": ["xlsx", "mammoth", "docx", "docx-preview"],
          "ffmpeg-vendor": ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
          "editor-vendor": [
            "@tiptap/react",
            "@tiptap/starter-kit",
            "@tiptap/extension-underline",
            "@tiptap/extension-text-style",
            "@tiptap/extension-font-family",
            "@tiptap/extension-color",
            "@tiptap/extension-text-align",
            "@tiptap/extension-highlight",
            "@tiptap/extension-task-list",
            "@tiptap/extension-task-item",
            "turndown",
          ],
          "canvas-vendor": ["fabric", "jspdf", "html2canvas"],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
}));
