import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    // `import.meta.dirname`, e não `__dirname`: o carregador de configuração
    // nativo do Vite 8 não define as variáveis do CommonJS.
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
});
