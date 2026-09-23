const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");
const prettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = defineConfig([
  {
    ignores: ["node_modules/**", ".expo/**", "dist/**", "build/**"],
  },
  expoConfig,
  prettierRecommended,
  {
    rules: {
      "prettier/prettier": "error",
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
    },
  },
]);
