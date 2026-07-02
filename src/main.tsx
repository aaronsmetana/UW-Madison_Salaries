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
// apply automatically in the background (registerType: 'autoUpdate' in vite.config.ts).
registerSW({ immediate: true });
