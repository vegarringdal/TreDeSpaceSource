import { createRoot } from 'react-dom/client';
import { PlayBar } from './PlayBar';
import { ViewportFrame } from './ViewportFrame';

/** Mount the animation's viewport UI into the host: the authoring frame
 *  (full-size, click-through) and the floating play bar (bottom centre). */
export function mountPlayBar(host: HTMLElement): () => void {
  const frame = document.createElement('div');
  frame.style.cssText = 'position:absolute;inset:0;z-index:7;pointer-events:none;';
  const el = document.createElement('div');
  // full width (centred inside): a left:50% box would shrink the bar to half
  // the view and wrap its buttons
  el.style.cssText =
    'position:absolute;left:8px;right:8px;bottom:14px;z-index:8;pointer-events:none;' +
    'display:flex;justify-content:center;';
  host.append(frame, el);
  const frameRoot = createRoot(frame);
  frameRoot.render(<ViewportFrame />);
  const root = createRoot(el);
  root.render(<PlayBar />);
  return () => {
    root.unmount();
    frameRoot.unmount();
    el.remove();
    frame.remove();
  };
}
