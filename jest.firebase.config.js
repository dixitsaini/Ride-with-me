module.exports = {
  testEnvironment: "node",
  testMatch: [
    "<rootDir>/**/*.rules.test.ts",
    "<rootDir>/**/*.integration.test.ts",
  ],
  transform: {
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!(firebase|@firebase)/)"],
  testTimeout: 30000,
};
