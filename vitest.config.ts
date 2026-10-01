import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Os testes do servidor declaram `@vitest-environment node` no topo: lá não
    // há DOM, e o jsdom mascararia diferenças reais de Request/FormData.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "api/**/*.test.ts"],
  },
  resolve: {
    // `import.meta.dirname`, e não `__dirname`: o carregador de configuração
    // nativo do Vite 8 não define as variáveis do CommonJS.
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
