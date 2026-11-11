import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Ellevee IA — Atendimento',
    short_name: 'Ellevee IA',
    description: 'Central de atendimento inteligente e chat ao vivo da Ellevee IA.',
    start_url: '/conversations',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0D0E18',
    theme_color: '#0D9488',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
