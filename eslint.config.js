import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },

  // Aplicação — roda no navegador.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Ligada de propósito: é a regra que revela import e variável órfãos.
      // O prefixo "_" marca o que é intencionalmente descartado.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },

  // Edge functions — rodam em Deno, não têm as globals do navegador.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.deno, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Estes módulos são importados via especificador "npm:", resolvido pelo
      // Deno em tempo de execução. O ESLint não enxerga os tipos deles, então
      // o interop precisa de `any` — os pontos afetados já carregam
      // deno-lint-ignore. Fica como aviso para não normalizar `any` novo.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Arquivos de configuração na raiz.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["*.{ts,js}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
