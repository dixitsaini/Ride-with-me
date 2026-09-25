module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: [
    "<rootDir>/jest.setup.ts",
    "<rootDir>/jest.silenceLogs.ts",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/android/",
    "/ios/",
    // Firebase rules/integration suites run under jest.firebase.config.js.
    "\\.rules\\.test\\.ts$",
    "\\.integration\\.test\\.ts$",
  ],
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
};
