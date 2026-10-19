import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles-refresh.css';

function reportRendererError(error: unknown): void {
  const errorName = error instanceof Error ? error.name : 'Error';
  window.relay.reportRendererError(errorName);
}

window.addEventListener('error', (event) => reportRendererError(event.error));
window.addEventListener('unhandledrejection', (event) => reportRendererError(event.reason));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);