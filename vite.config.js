import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/textures/unpkg': {
        target: 'https://unpkg.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/textures\/unpkg/, ''),
      },
      '/textures/nasa': {
        target: 'https://svs.gsfc.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/textures\/nasa/, ''),
      },
      '/textures/eoimages': {
        target: 'https://eoimages.gsfc.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/textures\/eoimages/, ''),
      },
      '/api/n2yo': {
        target: 'https://api.n2yo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/n2yo/, '/rest/v1/satellite') + '&apiKey=GMcdgASeCMndr78w6VgS5g34st7oYakIyc2JcCGL',
      },
    },
  },
});
