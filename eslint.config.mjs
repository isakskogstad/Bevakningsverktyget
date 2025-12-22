import js from "@eslint/js";
import globals from "globals";

export default [
  // Ignorera filer
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "downloads/**",
      "screenshots/**",
      ".cache/**",
      "lib/captcha/nopecha/**",
      "*.min.js",
      // Deno-filer hanteras separat
      "src/scrapers/supabase-integration-example.js",
    ],
  },

  // Grundkonfiguration för alla JavaScript-filer
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Varningar för vanliga problem
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off", // Tillåt console.log för debugging
      "prefer-const": "warn",
      "no-var": "warn",
      "eqeqeq": ["warn", "smart"],
      "no-throw-literal": "error",
      "no-return-await": "warn",
      "require-await": "warn",
      // Nedgraderade till varningar för legacy-kod
      "no-empty": "warn",
      "no-useless-escape": "warn",
      // Undvik formatering - låt Prettier hantera det
      "semi": "off",
      "quotes": "off",
      "indent": "off",
    },
  },

  // Frontend-specifik konfiguration (docs/assets/js)
  {
    files: ["docs/assets/js/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Globala variabler som används i frontend
        CONFIG: "readonly",
        Auth: "readonly",
        API: "readonly",
        Utils: "readonly",
        Components: "readonly",
        supabase: "readonly",
      },
    },
    rules: {
      // Dessa variabler deklareras och används i andra filer
      "no-unused-vars": ["warn", {
        varsIgnorePattern: "^(API|Auth|Utils|Components|CONFIG)$",
        argsIgnorePattern: "^_"
      }],
    },
  },

  // Backend/Scripts-specifik konfiguration
  {
    files: ["scripts/**/*.js", "src/**/*.js", "lib/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
];
