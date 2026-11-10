/**
 * Design Tokens Oficiais da Ellevee IA
 * Diretriz Criativa: Quiet Technology / Premium Corporate
 * Referências: Linear, Stripe, Vercel, Ramp, Notion
 */

export const ELLEVEE_TOKENS = {
  // 1. Paleta Institucional
  colors: {
    institutional: {
      deepInk: '#202520',       // Background Sidebar, textos principais e superfícies de autoridade
      warmIvory: '#F3F2ED',     // Background principal da aplicação
      pureWhite: '#FFFFFF',     // Superfície padrão dos cards e modais
      textSecondary: '#68716C', // Textos secundários, legendas, rótulos de apoio
      border: '#E5E5DF',        // Bordas sutis e divisórias
    },

    // 2. Cores de Destaque
    accent: {
      purple: '#7028D9',
      blue: '#087BEA',
      cyan: '#16BCE0',
    },

    // 3. Gradiente Institucional Oficial
    gradient: {
      default: 'linear-gradient(110deg, #7028D9 0%, #087BEA 65%, #16BCE0 100%)',
      hover: 'linear-gradient(110deg, #5f1ec2 0%, #076ecf 65%, #13a8c7 100%)',
      angle: '110deg',
      stops: [
        { color: '#7028D9', position: '0%' },
        { color: '#087BEA', position: '65%' },
        { color: '#16BCE0', position: '100%' },
      ],
    },

    // Estados Semânticos
    semantic: {
      success: '#15803D',
      warning: '#B45309',
      danger: '#B91C1C',
      info: '#087BEA',
    },
  },

  // 4. Tipografia
  typography: {
    fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    weights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
  },

  // 5. Superfícies e Componentes
  surfaces: {
    background: '#F3F2ED',
    sidebar: '#202520',
    cards: '#FFFFFF',
    textPrimary: '#202520',
    textSecondary: '#68716C',
    border: '#E5E5DF',
    radius: {
      card: '12px',
      button: '8px',
    },
  },

  // Sombras Discretas e Sutis (Quiet Tech)
  shadows: {
    subtle: '0 1px 2px 0 rgba(32, 37, 32, 0.04)',
    card: '0 1px 3px 0 rgba(32, 37, 32, 0.05), 0 1px 2px -1px rgba(32, 37, 32, 0.04)',
    elevated: '0 4px 6px -1px rgba(32, 37, 32, 0.06), 0 2px 4px -2px rgba(32, 37, 32, 0.05)',
    modal: '0 10px 25px -5px rgba(32, 37, 32, 0.12), 0 8px 10px -6px rgba(32, 37, 32, 0.08)',
  },
} as const

export type ElleveeTokens = typeof ELLEVEE_TOKENS
