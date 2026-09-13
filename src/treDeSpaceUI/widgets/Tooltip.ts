/**
 * Attribute-driven tooltips: put `data-tooltip="text"` on any element and it
 * gets a styled tooltip — no wrapper component, works in React and plain DOM
 * alike. Multi-line via real newlines or a literal "\n" in the attribute.
 *
 * One document-level listener drives everything; call initTooltips() once
 * (App does) and forget about it. The bubble sits below the element, flips
 * above when there is no room, and clamps to the viewport; inside a menu or
 * listbox it moves beside the whole list instead — see `tooltipPlacement.ts`.
 * It draws above every other floating layer.
 */

import { formatSequence, hotkeysActions } from '../hotkeys';
import { computeTooltipPlacement, type TooltipPlacement, type TooltipSide } from './tooltipPlacement';

const SHOW_DELAY = 400;
/** Above every other floating layer: popovers 1000, InfoButton 2000, Menu 3000. */
const Z_INDEX = '4000';
const ARROW_BORDER = '1px solid #3a4250';
const ARROW_POKE = '-4.5px'; // how far the rotated square sticks out of the edge
/** Floating lists whose entries a tooltip must never cover. */
const LIST_CONTAINERS = '[role="menu"],[role="listbox"]';

/** Per side: the bubble edge the arrow pokes out of, and the two square edges
 *  that outline the poking corner once it is rotated 45°. */
const ARROW_EDGES = {
  bottom: { edge: 'top', borders: ['borderTop', 'borderLeft'] },
  top: { edge: 'bottom', borders: ['borderBottom', 'borderRight'] },
  right: { edge: 'left', borders: ['borderBottom', 'borderLeft'] },
  left: { edge: 'right', borders: ['borderTop', 'borderRight'] },
} as const satisfies Record<TooltipSide, { edge: string; borders: readonly string[] }>;

let disposer: (() => void) | null = null;

export function initTooltips(): () => void {
  if (disposer) {
    return disposer; // singleton
  }

  const tip = document.createElement('div');
  Object.assign(tip.style, {
    position: 'fixed',
    zIndex: Z_INDEX,
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

  const applyArrow = (p: TooltipPlacement) => {
    const { edge, borders } = ARROW_EDGES[p.side];
    Object.assign(arrow.style, {
      top: '',
      right: '',
      bottom: '',
      left: '',
      borderTop: '0',
      borderRight: '0',
      borderBottom: '0',
      borderLeft: '0',
    } satisfies Partial<CSSStyleDeclaration>);
    arrow.style[edge] = ARROW_POKE;
    arrow.style[p.side === 'left' || p.side === 'right' ? 'top' : 'left'] = `${p.arrow}px`;
    for (const border of borders) {
      arrow.style[border] = ARROW_BORDER;
    }
  };

  const place = (el: HTMLElement) => {
    const list = el.closest(LIST_CONTAINERS);
    const placement = computeTooltipPlacement(
      el.getBoundingClientRect(),
      list?.getBoundingClientRect() ?? null,
      tip.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
    );
    tip.style.left = `${placement.left}px`;
    tip.style.top = `${placement.top}px`;
    applyArrow(placement);
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
