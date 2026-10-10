import '@fontsource-variable/overpass';
import '@fontsource-variable/overpass/wght-italic.css';
import '@fontsource-variable/overpass-mono';
import '@fontsource-variable/big-shoulders-display';
import './estilo/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ligarRota } from './lib/rota';
import { iniciar } from './lib/dados';

ligarRota();
iniciar();
createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
