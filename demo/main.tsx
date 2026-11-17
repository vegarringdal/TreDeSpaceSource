import { initTooltips } from '@treDeSpaceUI/widgets';
import { createRoot } from 'react-dom/client';
import { DemoApp } from './DemoApp';
import './demo.css';

initTooltips();

const rootEl = document.getElementById('root');
if (rootEl) {
  rootEl.textContent = '';
  createRoot(rootEl).render(<DemoApp />);
}
