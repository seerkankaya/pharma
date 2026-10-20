import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Uygulama } from './Uygulama';
import './stil.css';

// Tema ilk çizimden önce ayarlanır; giriş ekranı da kayıtlı temayla açılır.
let tema: string | null = null;
try {
  tema = localStorage.getItem('scalpiq-tema');
} catch {
  // Gizli pencerede depolama kapalı olabilir.
}
document.documentElement.dataset.tema = tema === 'koyu' || tema === 'acik' ? tema : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'koyu' : 'acik';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Uygulama />
  </StrictMode>,
);
