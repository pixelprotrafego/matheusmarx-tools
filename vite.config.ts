import { defineConfig } from "vite";
// `@vitejs/plugin-react`, e não a variante `-swc`. A partir do Vite 8 o
// transformador nativo é o oxc, e o próprio plugin de SWC avisa no build que
// deixou de ser o caminho rápido quando não há plugin de SWC em uso — que é o
// caso aqui. Trocar também tira 27 MB de binário nativo da instalação de quem
// clona o repositório.
import react from "@vitejs/plugin-react";
import path from "path";

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
 * Vite só têm alcance real quando alguém consegue falar com ele. Preso em
 * `localhost`, é preciso já estar na máquina; aberto na rede, qualquer um do
 * mesmo wi-fi consegue, e o que está em risco é o código de quem desenvolve.
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

/**
 * Pacotes pesados que ganham um arquivo próprio no build.
 *
 * Sem isso o navegador baixaria o motor de PDF para abrir a calculadora. Cada
 * grupo vira um pedaço carregado só quando a ferramenta que depende dele é
 * aberta.
 */
const GRUPOS_DE_PACOTES: ReadonlyArray<{ nome: string; pacotes: readonly string[] }> = [
  { nome: "pdf-vendor", pacotes: ["pdf-lib", "pdfjs-dist"] },
  { nome: "office-vendor", pacotes: ["xlsx", "docx", "docx-preview"] },
  { nome: "ffmpeg-vendor", pacotes: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  { nome: "editor-vendor", pacotes: ["@tiptap"] },
  // Fora do editor-vendor de propósito: o turndown é usado tanto pelo Notepad
  // quanto pela conversão HTML -> Markdown, e agrupá-lo com o TipTap faria a
  // conversão baixar o editor inteiro sem precisar.
  { nome: "turndown-vendor", pacotes: ["turndown"] },
  { nome: "canvas-vendor", pacotes: ["fabric", "jspdf", "html2canvas"] },
];

/** Escapa o que for caractere especial de expressão regular no nome do pacote. */
const escaparRegex = (texto: string) => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Traduz os grupos acima para o formato do Rolldown.
 *
 * O Vite 8 trocou o Rollup pelo Rolldown, que não aceita mais `manualChunks`
 * como objeto. A opção atual é `output.codeSplitting` — houve um `advancedChunks`
 * no meio do caminho, já marcado como obsoleto pelo próprio Rolldown.
 *
 * Cada teste casa com a pasta do pacote dentro de `node_modules`. A barra
 * depois do nome é o que impede `jspdf` de arrastar junto o `jspdf-autotable`,
 * e `docx` de arrastar o `docx-preview` por engano — este último está na lista
 * por nome próprio, porque ali é desejado.
 */
const gruposDeChunk = GRUPOS_DE_PACOTES.map(({ nome, pacotes }) => ({
  name: nome,
  test: new RegExp(`node_modules[\\\\/](?:${pacotes.map(escaparRegex).join("|")})[\\\\/]`),
}));

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
      // `import.meta.dirname`, e não `__dirname`: o carregador de configuração
      // nativo do Vite 8 não define as variáveis do CommonJS.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: gruposDeChunk,
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
}));
