import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  
  return {
    // Define o caminho base como relativo para que o Cloudflare encontre os assets
    base: './', 
    
    plugins: [react(), tailwindcss()],
    
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    
    resolve: {
      alias: {
        // Ajustado para apontar para a pasta src ou raiz de forma segura
        '@': path.resolve(__dirname, './src'), 
      },
    },
    
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    
    // Garante que o build limpe a pasta antes de gerar novos ficheiros
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    }
  };
});
