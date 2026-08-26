import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FocusScroll - Shorts & Reels Focus Intervention',
    description: 'Track YouTube Shorts & Instagram Reels dwell time and rebuild mindfulness with gentle scroll intervention.',
    permissions: ['storage'],
    host_permissions: [
      'https://www.youtube.com/*',
      'https://youtube.com/*',
      'https://www.instagram.com/*',
      'https://instagram.com/*',
    ],
    action: {
      default_title: 'FocusScroll - Shorts & Reels Focus Intervention',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
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

