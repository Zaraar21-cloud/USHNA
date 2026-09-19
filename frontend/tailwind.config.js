/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: { 50: '#F5F1FF', 100: '#ECE5FF', 200: '#D9CCFF', 500: '#7B4DFF', 600: '#6A3AF0', 700: '#5728D1' },
        ink: { DEFAULT: '#16161D', 2: '#5B5B6B', 3: '#8C8C9A' },
        line: '#E9E9EF',
        canvas: '#FAFAFC',
        viz: { pink: '#F2549B', green: '#7BD88F', orange: '#F59E42', yellow: '#F5C542', blue: '#6C9BF5' },
      },
      boxShadow: { card: '0 1px 2px rgba(22,22,29,0.04)' },
    },
  },
  plugins: [],
};
