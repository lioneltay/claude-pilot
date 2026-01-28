import * as esbuild from 'esbuild'

// Create require() shim for ESM bundles that need to use CJS modules
const requireShim = `
import { createRequire as __createRequire } from 'module';
const require = __createRequire(import.meta.url);
`

// Build both CLI and server bundles
async function build() {
  const commonOptions = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: false,
    minify: true,
    // Inject require shim for CJS compatibility
    banner: {
      js: requireShim,
    },
  }

  // Build CLI entry point
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/cli.js',
    banner: {
      js: '#!/usr/bin/env node\n' + requireShim,
    },
  })

  // Build server (spawned as background process)
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['src/server.ts'],
    outfile: 'dist/server.js',
  })

  console.log('Build complete: dist/cli.js, dist/server.js')
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
