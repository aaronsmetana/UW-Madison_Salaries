import './spa-restore';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@mantine/core/styles.css';
import './styles/print.css';
import './styles/app.css';
import App from './App';
import { registerSW } from 'virtual:pwa-register';
import { markUpdateReady } from './lib/appUpdate';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Caches the app shell + wasm + data artifacts so repeat visits skip the big downloads; updates
// apply automatically in the background (registerType: 'autoUpdate' in vite.config.ts). A page-load
// registration never re-checks on its own, so a long-lived tab can sit on a weeks-old build — poll
// hourly and whenever the tab regains focus so a fresh deploy lands without a manual hard-refresh.
/** How long after load an activation still counts as "part of startup", so reloading costs nothing. */
const STARTUP_GRACE_MS = 10_000;
const LOADED_AT = Date.now();

registerSW({
  immediate: true,
  // Without this, autoUpdate reloads the moment the new worker activates — which the hourly poll
  // below can trigger at any point in a reading session. Reload only if the update arrived during
  // startup; otherwise hand it to the next route change (see lib/appUpdate).
  onNeedReload() {
    if (Date.now() - LOADED_AT < STARTUP_GRACE_MS) window.location.reload();
    else markUpdateReady();
  },
  onRegisteredSW(_swUrl, r) {
    if (!r) return;
    const check = () => { if (navigator.onLine) r.update().catch(() => {}); };
    setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  },
});
