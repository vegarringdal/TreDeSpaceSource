/**
 * Attribute-driven tooltips: put `data-tooltip="text"` on any element and it
 * gets a styled tooltip — no wrapper component, works in React and plain DOM
 * alike. Multi-line via real newlines or a literal "\n" in the attribute.
 *
 * One document-level listener drives everything; call initTooltips() once
 * (App does) and forget about it. The bubble prefers sitting above the
 * element, flips below when there is no room, and clamps to the viewport.
 */

import { formatSequence, hotkeysActions } from '../hotkeys';

const SHOW_DELAY = 400;
const GAP = 7;

let disposer: (() => void) | null = null;

export function initTooltips(): () => void {
  if (disposer) {
    return disposer; // singleton
  }

  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'fixed',
    zIndex: '3000',
    maxWidth: '260px',
    padding: '5px 8px',
    border: '1px solid #3a4250',
    background: '#242933',
    color: '#c9cfd8',
    font: '12px/1.5 ui-sans-serif, system-ui, sans-serif',
    whiteSpace: 'pre-line',
    boxShadow: '0 4px 14px rgba(0,0,0,.45)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 100ms ease-out',
  } satisfies Partial<CSSStyleDeclaration>);

  const body = document.createElement('div');
  tip.appendChild(body);

  // The arrow: a rotated square poking out of the edge that faces the anchor.
  const arrow = document.createElement('div');
  Object.assign(arrow.style, {
    position: 'absolute',
    width: '8px',
    height: '8px',
    background: '#242933',
    transform: 'rotate(45deg)',
  } satisfies Partial<CSSStyleDeclaration>);
  tip.appendChild(arrow);
  document.body.appendChild(tip);

  let anchor: HTMLElement | null = null;
  let timer = 0;

  const hide = () => {
    clearTimeout(timer);
    timer = 0;
    anchor = null;
    tip.style.opacity = '0';
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    // Default: below the element, aligned to its left edge; flip above when
    // there is no room underneath, clamp to the viewport horizontally.
    const below = r.bottom + GAP + t.height <= window.innerHeight - 4 || r.top - GAP - t.height < 4;
    const top = below ? r.bottom + GAP : r.top - t.height - GAP;
    const left = Math.min(Math.max(4, r.left), window.innerWidth - t.width - 4);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;

    // Point the arrow at the anchor's centre (kept inside the bubble).
    const ax = Math.min(Math.max(8, r.left + r.width / 2 - left - 4), t.width - 16);
    arrow.style.left = `${ax}px`;
    if (below) {
      arrow.style.top = '-4.5px';
      arrow.style.bottom = '';
      arrow.style.borderTop = '1px solid #3a4250';
      arrow.style.borderLeft = '1px solid #3a4250';
      arrow.style.borderBottom = '0';
      arrow.style.borderRight = '0';
    } else {
      arrow.style.bottom = '-4.5px';
      arrow.style.top = '';
      arrow.style.borderBottom = '1px solid #3a4250';
      arrow.style.borderRight = '1px solid #3a4250';
      arrow.style.borderTop = '0';
      arrow.style.borderLeft = '0';
    }
  };

  const show = (el: HTMLElement, text: string) => {
    // append the current hotkey combo as a footer line when the element (or an
    // ancestor) carries data-shortcut — read live so user edits show at once
    let footer = '';
    let bodyText = text;
    const sc = el.closest('[data-shortcut]') as HTMLElement | null;
    const id = sc?.dataset.shortcut;
    if (id) {
      // no explicit tooltip? fall back to the binding's description
      if (!bodyText) {
        bodyText = hotkeysActions.describe(id) ?? '';
      }
      const seq = hotkeysActions.sequenceFor(id);
      if (seq) {
        footer = `${bodyText ? '\n\n' : ''}⌨  ${formatSequence(seq)}`;
      }
    }
    body.textContent = bodyText.replace(/\\n/g, '\n') + footer || '';
    tip.style.opacity = '0';
    // Render first so the size is real, then position and fade in.
    requestAnimationFrame(() => {
      if (anchor !== el) {
        return;
      }
      place(el);
      tip.style.opacity = '1';
    });
  };

  const onOver = (e: PointerEvent) => {
    const el = (e.target as Element).closest?.('[data-tooltip],[data-shortcut]') as HTMLElement | null;
    if (!el || el === anchor) {
      return;
    }
    const text = el.dataset.tooltip ?? '';
    // show if there's tooltip text OR a shortcut to display in the footer
    if (!text && !el.closest('[data-shortcut]')) {
      return;
    }
    clearTimeout(timer);
    anchor = el;
    timer = window.setTimeout(() => show(el, text), SHOW_DELAY);
  };

  const onOut = (e: PointerEvent) => {
    if (anchor && !anchor.contains(e.relatedTarget as Node)) {
      hide();
    }
  };

  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);

  disposer = () => {
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    document.removeEventListener('pointerdown', hide, true);
    document.removeEventListener('scroll', hide, true);
    window.removeEventListener('blur', hide);
    tip.remove();
    disposer = null;
  };
  return disposer;
}
