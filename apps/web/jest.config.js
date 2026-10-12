/**
 * Unit tests for pure frontend logic (no DOM): price formatting, quick-add decisions, routine
 * de-duplication. ts-jest compiles with CommonJS overrides because the app itself builds with
 * bundler resolution.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', moduleResolution: 'node', esModuleInterop: true, strict: true } }],
  },
};
