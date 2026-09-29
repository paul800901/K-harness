import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const output = resolve(root, 'dist');

await build({
  configFile: false,
  root: resolve(root, 'source/ui'),
  publicDir: false,
  logLevel: 'info',
  build: {
    outDir: output,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(root, 'source/background.ts'),
        connect: resolve(root, 'source/ui/connect.html'),
        status: resolve(root, 'source/ui/status.html'),
      },
      output: {
        entryFileNames: 'lib/[name].js',
        chunkFileNames: 'lib/[name].js',
        assetFileNames: 'lib/[name].[ext]',
      },
    },
  },
});

await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: 'info',
  build: {
    outDir: root,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(root, 'src/relay/entry.ts'),
      formats: ['cjs'],
      fileName: () => 'extension-protocol.cjs',
    },
    rollupOptions: {
      external: ['debug'],
      output: { exports: 'named' },
    },
  },
});

await mkdir(resolve(output, 'icons'), { recursive: true });
await copyFile(resolve(root, 'manifest.json'), resolve(output, 'manifest.json'));
for (const size of [16, 32, 48, 128])
  await copyFile(resolve(root, `icons/icon-${size}.png`), resolve(output, `icons/icon-${size}.png`));
await copyFile(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'));
