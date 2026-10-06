export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/**/*.test.ts', '<rootDir>/**/*.test.js', '<rootDir>/**/*.test.mjs'],
  testPathIgnorePatterns: ['/node_modules/'],
  coverageDirectory: './coverage',
  coveragePathIgnorePatterns: ['node_modules'],
  reporters: ['default'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { target: 'ES2022' } }],
  },
  moduleDirectories: ['node_modules', '<rootDir>'],
}
