import './spa-restore';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@mantine/core/styles.css';
import './styles/print.css';
import './styles/app.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Caches the app shell + wasm + data artifacts so repeat visits skip the big downloads; updates
// apply automatically in the background (registerType: 'autoUpdate' in vite.config.ts). A page-load
// registration never re-checks on its own, so a long-lived tab can sit on a weeks-old build — poll
// hourly and whenever the tab regains focus so a fresh deploy lands without a manual hard-refresh.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, r) {
    if (!r) return;
    const check = () => { if (navigator.onLine) r.update().catch(() => {}); };
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  },
});
