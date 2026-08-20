import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Noto Sans TC', 'sans-serif'],
      },
      colors: {
        // 對應 globals.css 的 CSS 變數,詳見該檔的調色盤說明
        surface: 'var(--surface-1)',
        plane: 'var(--page-plane)',
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        hairline: 'var(--gridline)',
        baseline: 'var(--baseline)',
      },
    },
  },
  plugins: [],
};

export default config;
