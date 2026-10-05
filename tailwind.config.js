/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Vazirmatn', 'Tahoma', 'sans-serif'] },
      colors: {
        brand: { DEFAULT: '#0f9b9b', dark: '#0b7c7c' },
        pos: { head: '#1abc9c', warn: '#e74c3c' }
      }
    }
  },
  plugins: [require('tailwindcss-rtl')]
}
