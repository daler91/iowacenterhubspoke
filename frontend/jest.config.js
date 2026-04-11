module.exports = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Playwright specs live under tests/e2e/ and are run by `npm run
  // test:e2e`. Jest's default testMatch would otherwise pick them up
  // and fail because they import from `@playwright/test`.
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        ['@babel/preset-react', { runtime: 'automatic' }],
        '@babel/preset-typescript',
      ],
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(@testing-library)/)',
  ],
};
