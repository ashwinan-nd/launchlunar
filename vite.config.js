import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // N2YO_API_KEY lives in .env (gitignored). See .env.example.
  // The previously committed key is burned in git history and must be
  // rotated at https://www.n2yo.com/api/ — do not reuse it.
  const env = loadEnv(mode, process.cwd(), '');
  const n2yoKey = env.N2YO_API_KEY || '';

  return {
    // satellite.js's WASM/pthreads worker bootstrap uses top-level await, which
    // the default 'iife' worker output format cannot emit. Bundle workers as ES
    // modules.
    worker: {
      format: 'es',
    },
    server: {
      port: 5199,
      strictPort: true,
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
          rewrite: (path) =>
            path.replace(/^\/api\/n2yo/, '/rest/v1/satellite') + `&apiKey=${n2yoKey}`,
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.js'],
    },
  };
});
