import process from 'node:process'

import { VitePWA } from 'vite-plugin-pwa'

/**
 * Pages that are not the editor's: OAuth callbacks, which relay a redirect, and, where a Cloud
 * server serves the editor, its API and its own pages, `CLOUD_PORTAL_PAGE_ROOTS` in
 * `@open-designer/cloud/contract`, which loads only once packages are built. Workbox matches the
 * path with its query, so a page root may be followed by `?` as well as `/`.
 */
export const NOT_EDITOR_PAGES = [
  /^\/oauth\//,
  /^\/oauth2\//,
  /^\/api\//,
  /^\/\.well-known\//,
  /^\/(?:welcome|auth|account|admin)(?:[/?]|$)/
]

function serverOwnedPaths(extraPrefixes: string | undefined): RegExp[] {
  const prefixes = (extraPrefixes ?? '')
    .split(',')
    .map((prefix) => prefix.trim())
    .filter((prefix) => prefix !== '')
  for (const prefix of prefixes) {
    if (!prefix.startsWith('/')) {
      throw new Error(`OPENDESIGNER_PWA_SERVER_PATHS entries must start with "/": ${prefix}`)
    }
  }
  return prefixes.map((prefix) => {
    const special = new Set([
      '.',
      '*',
      '+',
      '?',
      '^',
      '$',
      '{',
      '}',
      '(',
      ')',
      '|',
      '[',
      ']',
      '\\'
    ])
    const escaped = Array.from(prefix, (character) =>
      special.has(character) ? `\\\\${character}` : character
    ).join('')
    return prefix.endsWith('/')
      ? new RegExp('^' + escaped)
      : new RegExp('^' + escaped + '(?:[/?]|$)')
  })
}

export function openPencilPwaPlugin() {
  return VitePWA({
    registerType: 'autoUpdate',
    devOptions: { enabled: false },
    workbox: {
      maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      globPatterns: ['**/*.{js,css,html,wasm,png,svg,ico,ttf,webmanifest}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [
        ...NOT_EDITOR_PAGES,
        ...serverOwnedPaths(process.env.OPENDESIGNER_PWA_SERVER_PATHS)
      ]
    },
    manifest: {
      name: 'OpenDesigner',
      short_name: 'OpenDesigner',
      description: 'Open-source design editor',
      display: 'standalone',
      orientation: 'any',
      start_url: '/',
      scope: '/',
      theme_color: '#1e1e1e',
      background_color: '#1e1e1e',
      categories: ['design', 'productivity'],
      icons: [
        { src: '/brand/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/brand/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/brand/pwa-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable'
        }
      ]
    }
  })
}
