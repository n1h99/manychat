/** @type {import('jest').Config} */
module.exports = {
  displayName: 'api-integration',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  setupFiles: ['<rootDir>/test/set-environment.cjs'],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.integration-spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
};
