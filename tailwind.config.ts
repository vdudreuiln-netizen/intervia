import type { Config } from "tailwindcss";

// Palette à fort contraste : lisible en plein soleil sur chantier.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0B4F8A", dark: "#073A66", light: "#E6F0FA" },
        danger: { DEFAULT: "#B91C1C", light: "#FEE2E2" },
        ok: { DEFAULT: "#15803D", light: "#DCFCE7" },
      },
      fontSize: { base: ["1.0625rem", "1.6"] },
    },
  },
  plugins: [],
};
export default config;
