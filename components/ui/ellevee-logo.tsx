import React from 'react'
import Image from 'next/image'
import Link from 'next/link'

export interface ElleveeLogoProps {
  /**
   * Variante visual do logotipo
   * - full: Símbolo oficial + Wordmark "Ellevee IA"
   * - icon: Apenas o símbolo/ícone oficial
   * - wordmark: Apenas a tipografia oficial "Ellevee IA"
   */
  variant?: 'full' | 'icon' | 'wordmark'

  /**
   * Tema da superfície onde o logo está aplicado
   * - dark: Para fundos escuros (Deep Ink #202520, Preto) — texto Ellevee em Pure White (#FFFFFF)
   * - light: Para fundos claros (Warm Ivory #F3F2ED, Branco) — texto Ellevee em Deep Ink (#202520)
   */
  theme?: 'dark' | 'light'

  /**
   * Tamanho proporcional do conjunto
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'

  /**
   * Variante do ícone do símbolo
   * - ribbon: Símbolo "e" 3D com transparência (padrão)
   * - squircle-dark: App Icon oficial em squircle escuro
   * - squircle-light: App Icon oficial em squircle claro
   */
  iconVariant?: 'ribbon' | 'squircle-dark' | 'squircle-light'

  /**
   * Exibir a assinatura / slogan institucional:
   * "Inteligência que conecta. Resultados que evoluem."
   */
  withTagline?: boolean

  /**
   * Badge opcional ao lado do nome (ex: "ADMIN", "PRO", "BETA")
   */
  badge?: string

  /**
   * URL para transformar o logotipo em link clicável
   */
  href?: string

  /**
   * Classes adicionais no container
   */
  className?: string

  /**
   * Prioridade de carregamento na imagem Next.js
   */
  priority?: boolean
}

const SIZE_MAP = {
  xs: {
    icon: 20,
    text: 'text-xs',
    tagline: 'text-[9px]',
    gap: 'gap-1.5',
    badgeText: 'text-[8px] px-1 py-0.2',
  },
  sm: {
    icon: 26,
    text: 'text-sm',
    tagline: 'text-[10px]',
    gap: 'gap-2',
    badgeText: 'text-[9px] px-1.5 py-0.5',
  },
  md: {
    icon: 34,
    text: 'text-base',
    tagline: 'text-xs',
    gap: 'gap-2.5',
    badgeText: 'text-[9px] px-1.5 py-0.5',
  },
  lg: {
    icon: 44,
    text: 'text-xl',
    tagline: 'text-xs',
    gap: 'gap-3',
    badgeText: 'text-[10px] px-2 py-0.5',
  },
  xl: {
    icon: 56,
    text: 'text-2xl',
    tagline: 'text-sm',
    gap: 'gap-3.5',
    badgeText: 'text-xs px-2.5 py-1',
  },
}

export function ElleveeLogo({
  variant = 'full',
  theme = 'light',
  size = 'md',
  iconVariant = 'ribbon',
  withTagline = false,
  badge,
  href,
  className = '',
  priority = false,
}: ElleveeLogoProps) {
  const currentSize = SIZE_MAP[size]

  // Seleciona o asset correto de ícone
  let iconSrc = '/images/logo-icon.png'
  if (iconVariant === 'squircle-dark') {
    iconSrc = '/images/app-icon-dark.png'
  } else if (iconVariant === 'squircle-light') {
    iconSrc = '/images/app-icon-light.png'
  }

  // Cor do texto Ellevee conforme o tema
  const wordmarkTextColor = theme === 'dark' ? 'text-white' : 'text-ellevee-deep-ink'
  const taglineTextColor = theme === 'dark' ? 'text-[#A6B5A6]' : 'text-ellevee-text-secondary'

  const content = (
    <div
      className={`inline-flex items-center ${currentSize.gap} select-none ${className}`}
      data-testid="ellevee-logo"
    >
      {/* 1. Símbolo Isotipo */}
      {variant !== 'wordmark' && (
        <div
          className="relative shrink-0 flex items-center justify-center transition-transform hover:scale-105 duration-200"
          style={{ width: currentSize.icon, height: currentSize.icon }}
        >
          <Image
            src={iconSrc}
            alt="Ellevee IA Logo"
            width={currentSize.icon}
            height={currentSize.icon}
            className="object-contain w-full h-full drop-shadow-2xs"
            priority={priority}
          />
        </div>
      )}

      {/* 2. Wordmark ("Ellevee IA") + Tagline + Badge */}
      {variant !== 'icon' && (
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-1.5 leading-none">
            <span
              className={`font-display font-bold tracking-tight ${currentSize.text} ${wordmarkTextColor} transition-colors`}
            >
              Ellevee
            </span>
            <span
              className={`font-display font-extrabold tracking-tight ${currentSize.text} bg-gradient-to-r from-[#7028D9] via-[#087BEA] to-[#16BCE0] bg-clip-text text-transparent`}
            >
              IA
            </span>

            {badge && (
              <span
                className={`font-mono font-bold tracking-wider uppercase text-white bg-ellevee-gradient rounded shadow-2xs ${currentSize.badgeText}`}
              >
                {badge}
              </span>
            )}
          </div>

          {withTagline && (
            <span
              className={`font-sans font-medium tracking-tight mt-1 ${currentSize.tagline} ${taglineTextColor}`}
            >
              Inteligência que conecta. Resultados que evoluem.
            </span>
          )}
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        className="inline-flex focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ellevee-purple/50 rounded-lg group"
        title="Ellevee IA"
      >
        {content}
      </Link>
    )
  }

  return content
}
