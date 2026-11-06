import type { Metadata } from 'next'
import './globals.css'

// As fontes são resolvidas via stack local (variáveis CSS em globals.css) para
// que o build não dependa de rede externa (fonts.googleapis.com).
export const metadata: Metadata = {
  title: 'Ellevee IA',
  description: 'Inteligência que conecta. Resultados que evoluem.',
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
