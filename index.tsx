import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Global error reporter for mobile debugging
window.onerror = function (message, source, lineno, colno, error) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; background: #fee2e2; border: 2px solid #ef4444; color: #991b1b; border-radius: 12px; margin: 20px; font-family: sans-serif;">
        <h1 style="font-size: 18px; margin-bottom: 10px;">❌ Erro Crítico Detectado</h1>
        <p style="font-size: 14px; margin-bottom: 10px;">O aplicativo não pôde ser iniciado corretamente.</p>
        <pre style="white-space: pre-wrap; font-size: 12px; background: #fca5a5; padding: 10px; border-radius: 6px;">${message}\n${source}:${lineno}:${colno}</pre>
        <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer;">Tentar Novamente</button>
      </div>
    `;
  }
  return false;
};

window.onunhandledrejection = function (event) {
  console.error('Unhandled promise rejection:', event.reason);
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);