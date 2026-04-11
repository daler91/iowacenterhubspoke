module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
  ],
  plugins: [
    // Vite code (e.g. `src/lib/api.ts`) reads `import.meta.env.*`. Jest uses
    // Babel, which can't eval `import.meta`. These plugins substitute a
    // `process.env.*`-style shim so those modules can be imported under test.
    'babel-plugin-transform-vite-meta-env',
    'babel-plugin-transform-import-meta',
  ],
};
