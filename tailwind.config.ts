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
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--font-manrope)', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
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
        // Paleta Oficial Ellevee IA (Quiet Technology / Premium Corporate)
        ellevee: {
          ivory: "#F3F2ED",
          ink: "#202520",
          white: "#FFFFFF",
          sage: "#718071",
          accent: "#B7D957",
          stone: "#E7E6E0",
          "stone-subtle": "#F8F8F5",
          "ink-muted": "#3A403A",
          "sage-light": "#EEF1EE",
          "accent-muted": "#E5F2BF",
          // Variante escura do sage para texto pequeno (contraste AA em fundo claro)
          "sage-strong": "#5A6659",
        },
        // Paleta semântica de notas internas (âmbar quente, contida)
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
      borderRadius: {
        lg: "8px",
        md: "6px",
        sm: "4px",
      },
      // Escala tipográfica mínima para conteúdo operacional (rótulos, metadados,
      // legendas). 13px é o menor tamanho legível em densidade de dashboard.
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
