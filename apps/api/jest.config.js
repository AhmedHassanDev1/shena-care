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
  setupFilesAfterEnv: ['<rootDir>/test/test-database-guard.ts'],
  testTimeout: 15000,
  moduleNameMapper: {
    ...(process.env.PIPELINE_PRISMA_CLIENT && process.env.NODE_ENV === 'test'
      ? { '^@prisma/client$': process.env.PIPELINE_PRISMA_CLIENT } : {}),
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
