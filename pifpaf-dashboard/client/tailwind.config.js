/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          400: '#5e7dff',
          500: '#3b5eff',
          600: '#2e4deb',
          700: '#1f3bcc',
        },
        peach: {
          400: '#ff8c42',
        },
        ink: {
          100: '#e6ebf5',
          200: '#c8d1e8',
          300: '#97a3c2',
          500: '#5a6b92',
          700: '#2a3361',
          900: '#0e1330',
        }
      },
      fontFamily: {
        display: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'card-lg': '2rem',
      },
      boxShadow: {
        'soft': '0 8px 20px -10px rgba(14,19,48,0.1), 0 1px 4px -2px rgba(14,19,48,0.05)',
        'card': '0 24px 60px -24px rgba(14,19,48,0.18), 0 6px 14px -8px rgba(14,19,48,0.08)',
        'brand': '0 14px 36px -10px rgba(59,94,255,0.45)',
        'brand-lg': '0 20px 48px -12px rgba(59,94,255,0.55)',
      },
      animation: {
        'fade-in': 'fade-in 0.32s cubic-bezier(0.16,1,0.3,1) both',
        'fade-up': 'fade-up 0.48s cubic-bezier(0.16,1,0.3,1) both',
        'pop': 'pop 0.42s cubic-bezier(0.34,1.4,0.64,1) both',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        'pop': {
          '0%': { opacity: '0', transform: 'scale(0.88)' },
          '55%': { opacity: '1', transform: 'scale(1.025)' },
          '100%': { opacity: '1', transform: 'scale(1)' }
        }
      }
    },
  },
  plugins: [],
}