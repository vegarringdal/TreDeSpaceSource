import './lib/globalReset'; // MUST be first — wipes stale config before any store loads
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSpaEnv } from './lib/spaEnv';
import './styles.css';

// container-injected runtime config first, so it's available everywhere
void loadSpaEnv().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
