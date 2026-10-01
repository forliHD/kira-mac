import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "dist/**", "node_modules/**", "helper/**", "build/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Grenzen zur IPC bekommen `unknown` + Laufzeitprüfung, nie `any`.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/shared/dictationText.js"],
    rules: {},
  },
  {
    // electron-builder lädt Hooks als CommonJS (afterPack).
    files: ["scripts/**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable", console: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
