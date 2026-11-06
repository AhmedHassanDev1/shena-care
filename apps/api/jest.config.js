module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  // Real research-provider keys from .env must never reach a test.
  setupFiles: ['<rootDir>/test/isolate-providers.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/test-database-guard.ts'],
  // Booting AppModule in beforeAll occasionally exceeds 15 s on a loaded Windows host (hook timeouts, not test failures).
  testTimeout: 30000,
  moduleNameMapper: {
    ...(process.env.PIPELINE_PRISMA_CLIENT && process.env.NODE_ENV === 'test'
      ? { '^@prisma/client$': process.env.PIPELINE_PRISMA_CLIENT } : {}),
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
