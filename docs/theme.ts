// theme.ts — shared light/dark toggle for the /docs pages. Stamps
// data-theme on <html> so it overrides the prefers-color-scheme media query in
// both directions, and remembers the choice for the session. Every page loads
// this and includes the <button id="themeToggle"> in its top bar.
//
// Exports currentTheme()/toggleTheme() so a page (e.g. the live demo) can read
// the page theme and drive its own toggle through the same single source of
// truth — the data-theme attribute on <html>.

const root = document.documentElement;
const icon = document.getElementById('themeIcon');
const label = document.getElementById('themeLabel');

export type Theme = 'light' | 'dark';

/** The page's current theme (data-theme on <html>; defaults to dark). */
export function currentTheme(): Theme {
  return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme): void {
  root.setAttribute('data-theme', theme);
  if (icon) {
    icon.textContent = theme === 'dark' ? '☾' : '☀';
  }
  if (label) {
    label.textContent = theme;
  }
}

/** Flip the page theme, persist it for the session, and return the new value. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  apply(next);
  try {
    sessionStorage.setItem('tds-theme', next);
  } catch {
    /* ignore */
  }
  return next;
}

let saved: string | null = null;
try {
  saved = sessionStorage.getItem('tds-theme');
} catch {
  /* storage blocked (private mode / sandboxed) — fall back to the OS pref */
}

const initial: Theme =
  saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
apply(initial);

document.getElementById('themeToggle')?.addEventListener('click', () => toggleTheme());
