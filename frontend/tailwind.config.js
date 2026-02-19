/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#0F172A",
        ink: "#E2E8F0",
        accent: "#0EA5E9",
        accent2: "#22C55E",
        danger: "#F43F5E"
      },
      boxShadow: {
        soft: "0 10px 35px rgba(14, 165, 233, 0.18)"
      }
    }
  },
  plugins: []
};
