const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['./extension.js'],
  bundle: true,
  outfile: './dist/extension.js',
  platform: 'node',
  target: 'node18',
  external: ['vscode'],
  format: 'cjs',
  minify: true,
  sourcemap: true
}).then(() => {
  console.log('Build complete: dist/extension.js');
}).catch(() => process.exit(1));
