module.exports = {
  testEnvironment: "node",
  setupFilesAfterEnv: [
    "<rootDir>/jest.silenceLogs.ts",
    "<rootDir>/jest.firebaseSetup.ts",
  ],
  testMatch: [
    "<rootDir>/**/*.rules.test.ts",
    "<rootDir>/**/*.integration.test.ts",
  ],
  moduleNameMapper: {
    "^react-native$": "<rootDir>/jest.stubs/react-native.ts",
  },
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!(firebase|@firebase)/)"],
  testTimeout: 30000,
};
