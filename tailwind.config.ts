import type { Config } from "tailwindcss";

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
      colors: {
        // ── shadcn semantic tokens (mapped to Stitch slate-blue system) ──
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

        // ── Stitch full palette ──
        "stitch-primary":           "#545f73",
        "stitch-primary-dim":       "#485367",
        "stitch-primary-container": "#d8e3fb",
        "stitch-on-primary":        "#f6f7ff",
        "stitch-secondary":         "#526074",
        "stitch-secondary-dim":     "#465468",
        "stitch-tertiary":          "#006b63",
        "stitch-tertiary-dim":      "#005e57",
        "stitch-tertiary-container":"#a7fef3",
        "stitch-on-tertiary":       "#e2fffa",
        "stitch-error":             "#9f403d",
        "stitch-error-container":   "#fe8983",
        "stitch-on-error-container":"#752121",

        // Surface tonal tiers
        "surface":                    "#f7f9fb",
        "surface-bright":             "#f7f9fb",
        "surface-dim":                "#cfdce3",
        "surface-container-lowest":   "#ffffff",
        "surface-container-low":      "#f0f4f7",
        "surface-container":          "#e8eff3",
        "surface-container-high":     "#e1e9ee",
        "surface-container-highest":  "#d9e4ea",
        "surface-variant":            "#d9e4ea",
        "surface-tint":               "#545f73",

        // On-surface
        "on-background":              "#2a3439",
        "on-surface":                 "#2a3439",
        "on-surface-variant":         "#566166",
        "inverse-surface":            "#0b0f10",
        "inverse-on-surface":         "#9a9d9f",

        // Outline
        "outline":                    "#717c82",
        "outline-variant":            "#a9b4b9",

        // Additional Stitch tokens
        "on-primary-container":       "#475266",
        "on-secondary-container":     "#455367",
        "on-tertiary-container":      "#00645d",
        "on-tertiary-fixed":          "#004f4a",
        "on-tertiary-fixed-variant":  "#006f67",
        "primary-fixed":              "#d8e3fb",
        "primary-fixed-dim":          "#cad5ed",
        "secondary-fixed":            "#d5e3fc",
        "secondary-fixed-dim":        "#c7d5ed",
        "tertiary-fixed":             "#a7fef3",
        "tertiary-fixed-dim":         "#99efe5",
        "secondary-container":        "#d5e3fc",
        "inverse-primary":            "#dae6fe",
      },

      borderRadius: {
        // Stitch: 0px everywhere. Only full for avatars / status dots.
        DEFAULT: "0px",
        none:    "0px",
        sm:      "0px",
        md:      "0px",
        lg:      "0px",
        xl:      "0px",
        "2xl":   "0px",
        "3xl":   "0px",
        full:    "9999px",
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to:   { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to:   { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up":   "accordion-up 0.2s ease-out",
      },

      fontFamily: {
        sans:    ["var(--font-sans)"],    // Inter
        mono:    ["var(--font-mono)"],    // JetBrains Mono
        display: ["var(--font-display)"], // Space Grotesk
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

export default config;
