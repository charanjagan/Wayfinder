import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#FAFAFA',
        ink: '#1E2328',
        border: '#D8DBDF',
        accent: '#2954D9',
        'accent-hover': '#1F41AD',
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
      },
      borderRadius: {
        sm: '2px',
        DEFAULT: '3px',
        md: '4px',
      },
      keyframes: {
        flow: {
          to: { strokeDashoffset: '-20' },
        },
      },
      animation: {
        flow: 'flow 0.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
