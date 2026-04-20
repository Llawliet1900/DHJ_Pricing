import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages 部署到 /DHJ_Pricing/ 子路径
export default defineConfig({
  plugins: [react()],
  base: '/DHJ_Pricing/',
});
