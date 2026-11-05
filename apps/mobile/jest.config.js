module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  // packages/shared resolves via its real path (outside this app); let its imports — e.g. Babel
  // runtime helpers — fall back to this app's node_modules, exactly like metro.config.js does.
  modulePaths: ['<rootDir>/node_modules'],
  moduleNameMapper: {
    // packages/shared uses NodeNext `.js` specifiers for its `.ts` sources.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@maplibre/maplibre-react-native|@drayvision)/)',
  ],
};
