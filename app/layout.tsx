import type { Metadata, Viewport } from 'next'
import './globals.css'

// As fontes são resolvidas via stack local (variáveis CSS em globals.css) para
// que o build não dependa de rede externa (fonts.googleapis.com).
export const metadata: Metadata = {
  title: 'Ellevee IA',
  description: 'Inteligência que conecta. Resultados que evoluem.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Ellevee IA',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body className="font-sans">{children}</body>
    </html>
  )
}
