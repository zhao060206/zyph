import { build } from 'esbuild';

await build({
  entryPoints: ['src/app.js'], outfile: 'public/app.js', bundle: true,
  format: 'iife', target: 'es2017',
  minify: true, legalComments: 'none', charset: 'utf8',
});
await build({ entryPoints: ['src/site.css'], outfile: 'public/site.css', bundle: true, minify: true,
  target: ['chrome64', 'safari12', 'firefox67'], legalComments: 'none' });
console.log('Built public/app.js and public/site.css');
