import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Silence Vite HMR and WebSocket unhandled connection exceptions in AI Studio iframe environment
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && (
    event.reason.message?.includes('WebSocket') || 
    event.reason.message?.includes('HMR') || 
    event.reason.message?.includes('websocket')
  )) {
    event.preventDefault();
  }
});

window.addEventListener('error', (event) => {
  if (event.message?.includes('WebSocket') || event.message?.includes('websocket')) {
    event.preventDefault();
  }
});

createRoot(document.getElementById('root')!).render(<App />);
