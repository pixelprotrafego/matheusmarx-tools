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
const GRUPOS_DE_PACOTES: ReadonlyArray<{ nome: string; pacotes: readonly string[]; tambem?: RegExp }> = [
  // Primeiro da lista, para vencer os outros grupos: cada grupo leva junto as
  // dependências dos seus pacotes, e o React (que o TipTap usa) ia parar no
  // editor-vendor, o tslib, o fflate e o auxiliar de import() do Vite no
  // pdf-vendor. Como a página inicial precisa deles, toda visita baixava o
  // editor e o motor de PDF inteiros (cerca de 1,4 MB) antes de qualquer clique.
  {
    nome: "base-vendor",
    pacotes: ["react", "react-dom", "scheduler", "use-sync-external-store", "tslib", "fflate"],
    tambem: /vite[\\/]preload-helper/,
  },
  // "@cantoo/pdf-lib": o projeto usa este fork; o "pdf-lib" que estava aqui não
  // casava com nada, e o motor de PDF ia parar em pedaços compartilhados.
  { nome: "pdf-vendor", pacotes: ["@cantoo/pdf-lib", "pdfjs-dist"] },
  { nome: "office-vendor", pacotes: ["xlsx", "docx"] },
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
 * depois do nome é o que impede um nome de casar com outro pacote que só
 * começa igual (`jspdf` com um `jspdf-algo`, `docx` com um `docx-algo`).
 */
const gruposDeChunk = GRUPOS_DE_PACOTES.map(({ nome, pacotes, tambem }) => ({
  name: nome,
  test: new RegExp(
    `node_modules[\\\\/](?:${pacotes.map(escaparRegex).join("|")})[\\\\/]${tambem ? `|${tambem.source}` : ""}`,
  ),
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
