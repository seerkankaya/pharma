import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Uygulama } from './Uygulama';
import './stil.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Uygulama />
  </StrictMode>,
);
