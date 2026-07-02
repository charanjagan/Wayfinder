import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zone: '#6366f1',
        room: '#059669',
        facility: '#d97706',
      },
      keyframes: {
        dash: {
          to: { strokeDashoffset: '-24' },
        },
      },
      animation: {
        dash: 'dash 1s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
