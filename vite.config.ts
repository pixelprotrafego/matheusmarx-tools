import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
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
          "office-vendor": ["xlsx", "docx", "docx-preview"],
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
          ],
          // Fora do editor-vendor de propósito: o turndown é usado tanto pelo
          // Notepad quanto pela conversão HTML -> Markdown, e agrupá-lo com o
          // TipTap faria a conversão baixar o editor inteiro sem precisar.
          "turndown-vendor": ["turndown"],
          "canvas-vendor": ["fabric", "jspdf", "html2canvas"],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
}));
