import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FocusScroll Extension',
    description: 'Track YouTube Shorts viewing dwell time and rebuild focus',
    permissions: ['storage'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
    ],
  },
  webExt: {
    disabled: true,
  },
  dev: {
    server: {
      host: '0.0.0.0',
      port: 3000,
      strictPort: true,
    },
  },
  hooks: {
    'vite:devServer:extendConfig'(config) {
      config.plugins = config.plugins || [];
      config.plugins.push({
        name: 'root-to-popup-redirect',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url === '/' || req.url === '/index.html' || req.url === '/popup.html') {
              req.url = '/entrypoints/popup/index.html';
            }
            next();
          });
        },
      });
    },
  },
});

