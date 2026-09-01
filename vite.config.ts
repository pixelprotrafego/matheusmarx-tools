import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
/**
 * Porta única do projeto, em desenvolvimento, no `preview` e no contêiner.
 *
 * Ter um número só evita a confusão de "em qual porta está rodando agora?" e é
 * o mesmo endereço citado no README e no docker-compose.
 */
const PORT = 7767;

/**
 * Onde o servidor de desenvolvimento escuta.
 *
 * Por padrão, só `localhost`. O projeto vinha com `host: "::"`, herdado da
 * Lovable, que faz o Vite aceitar conexão de qualquer máquina da mesma rede —
 * o log de partida chegava a anunciar o endereço de rede junto com o local.
 *
 * Isso importa porque as falhas conhecidas do servidor de desenvolvimento do
 * Vite (path traversal na entrega dos `.map`, contorno do `server.fs.deny` em
 * caminhos alternativos do Windows) só têm alcance real quando alguém consegue
 * falar com ele. Preso em `localhost`, é preciso já estar na máquina; aberto na
 * rede, qualquer um do mesmo wi-fi consegue, e o que está em risco é o código
 * de quem desenvolve, não o site publicado.
 *
 * Para testar num celular ou noutra máquina da rede, é opt-in explícito:
 *
 *     DEV_EXPOSE=1 npm run dev
 *
 * O nome não começa com `VITE_` de propósito: prefixo `VITE_` vai parar dentro
 * do JavaScript entregue ao navegador, e isto aqui é só configuração de quem
 * desenvolve.
 */
const HOST = process.env.DEV_EXPOSE ? "::" : "localhost";

export default defineConfig(() => ({
  server: {
    host: HOST,
    port: PORT,
    hmr: {
      overlay: false,
    },
  },
  preview: {
    host: HOST,
    port: PORT,
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
