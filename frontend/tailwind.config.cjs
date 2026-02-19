/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F172A',
        mist: '#E6EDF6',
        accent: '#0EA5A4',
        accentSoft: '#9FE7E5',
        warning: '#F97316',
        up: '#16A34A',
        down: '#DC2626',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 10px 30px rgba(15, 23, 42, 0.12)',
      },
      backgroundImage: {
        grid: 'radial-gradient(circle at 1px 1px, rgba(15, 23, 42, 0.07) 1px, transparent 0)',
      },
    },
  },
  plugins: [],
}
