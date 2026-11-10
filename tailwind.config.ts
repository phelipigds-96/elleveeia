import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-jakarta)', 'var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--font-jakarta)', 'var(--font-manrope)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        jakarta: ['var(--font-jakarta)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },

        // ==========================================
        // PALETA OFICIAL ELLEVEE IA (Design Tokens)
        // Quiet Technology / Premium Corporate
        // ==========================================
        ellevee: {
          // 1. Paleta Institucional
          "deep-ink": "#202520",
          ink: "#202520",
          "warm-ivory": "#F3F2ED",
          ivory: "#F3F2ED",
          "pure-white": "#FFFFFF",
          white: "#FFFFFF",
          secondary: "#68716C",
          "text-secondary": "#68716C",
          sage: "#68716C", // Aliased para compatibilidade com o texto secundário oficial
          border: "#E5E5DF",
          stone: "#E5E5DF", // Aliased para compatibilidade com a borda oficial

          // 2. Cores de Destaque
          purple: "#7028D9",
          blue: "#087BEA",
          cyan: "#16BCE0",

          // Acentos e variações de suporte
          accent: "#087BEA",
          "accent-purple": "#7028D9",
          "accent-cyan": "#16BCE0",
          "accent-lime": "#B7D957",
          "accent-muted": "#E0ECFB",
          "sage-strong": "#525A55",
          "sage-light": "#F0F2F0",
          "stone-subtle": "#F8F8F6",
          "ink-muted": "#3A403A",

          // Tokens semânticos de estado
          warning: "#B45309",
          "warning-strong": "#854D0E",
          success: "#15803D",
          "success-strong": "#14532D",
          info: "#087BEA",
          "info-strong": "#0662BA",
          danger: "#B91C1C",
          "danger-strong": "#7F1D1D",
        },

        // Paleta semântica de notas internas
        note: {
          bg: "#FEFCE8",
          border: "#FEF08A",
          "border-strong": "#FDE047",
          focus: "#EAB308",
          text: "#713F12",
          strong: "#854D0E",
          accent: "#CA8A04",
        },
      },

      // 3. Gradiente Institucional Oficial
      backgroundImage: {
        "ellevee-gradient": "linear-gradient(110deg, #7028D9 0%, #087BEA 65%, #16BCE0 100%)",
        "ellevee-gradient-hover": "linear-gradient(110deg, #5f1ec2 0%, #076ecf 65%, #13a8c7 100%)",
      },

      // 5. Border Radius Oficiais (Cards: 12px, Botões: 8px)
      borderRadius: {
        card: "12px",
        btn: "8px",
        xl: "12px",
        lg: "8px",
        md: "6px",
        sm: "4px",
      },

      // Sombras Discretas e Sutis (Quiet Tech)
      boxShadow: {
        "2xs": "0 1px 2px 0 rgba(32, 37, 32, 0.03)",
        subtle: "0 1px 2px 0 rgba(32, 37, 32, 0.04)",
        card: "0 1px 3px 0 rgba(32, 37, 32, 0.05), 0 1px 2px -1px rgba(32, 37, 32, 0.04)",
        elevated: "0 4px 6px -1px rgba(32, 37, 32, 0.06), 0 2px 4px -2px rgba(32, 37, 32, 0.05)",
        modal: "0 10px 25px -5px rgba(32, 37, 32, 0.12), 0 8px 10px -6px rgba(32, 37, 32, 0.08)",
      },

      fontSize: {
        meta: ["13px", { lineHeight: "1.5" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
