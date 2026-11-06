module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // zod 4 (shared schemas) ships `export * as ns from` syntax, which the RN preset doesn't transform.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
