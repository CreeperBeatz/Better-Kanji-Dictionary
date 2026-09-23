import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import type { OutputBundle, OutputChunk } from 'rolldown'

/**
 * Writes sw.js from sw.template.js, listing what the first screen needs --
 * the page, the entry's scripts and styles, the lookup worker and the icons
 * -- so an installed app opens without a connection. Lazy chunks are left to
 * the worker to cache the first time they are used: Excalidraw alone is
 * megabytes nobody should download just for installing.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle: OutputBundle) {
      const shell = new Set<string>(['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png'])
      const visit = (name: string) => {
        const out = bundle[name]
        if (!out || shell.has(`/${name}`)) return
        shell.add(`/${name}`)
        if (out.type !== 'chunk') return
        const chunk = out as OutputChunk & { viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> } }
        chunk.imports.forEach(visit)
        chunk.viteMetadata?.importedCss.forEach((css) => shell.add(`/${css}`))
      }
      for (const [name, out] of Object.entries(bundle)) {
        if (out.type === 'chunk' && out.isEntry) visit(name)
        if (/lookup\.worker/.test(name)) visit(name)
      }
      const files = [...shell].sort()
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
      const source = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__SHELL__', JSON.stringify(files, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: {
      // onnxruntime-web's exports map hides the runtime files the draw pad has
      // to hand it by URL (src/draw/classifier.ts), so they are reached by path.
      'ort-dist': fileURLToPath(new URL('./node_modules/onnxruntime-web/dist', import.meta.url)),
    },
  },
  // Pre-bundling would inline the runtime's glue module where a URL to it is
  // wanted, and the runtime would then try to import its source text.
  optimizeDeps: { exclude: ['onnxruntime-web', 'ort-dist'] },
})
