import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // `/api` vai para a API local na mesma origem, para o cookie de renovação valer.
    proxy: {
      '/api': {
        target: 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        // A API grava o cookie de renovação com `Path=/auth/panel`; pelo proxy, o navegador
        // chama `/api/auth/panel/*`, então o caminho do cookie precisa acompanhar o prefixo.
        // Em produção, sirva a API no mesmo prefixo do `VITE_API_URL` ou reescreva o `Path`.
        cookiePathRewrite: { '/auth/panel': '/api/auth/panel' },
      },
    },
  },
});
