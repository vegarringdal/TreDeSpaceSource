// -----------------------------------------------------------------------------
// shipped overlay presets (DESIGN.md › Animation › Overlays)
// -----------------------------------------------------------------------------
// The editor always opens from one of these. Ids are stable (`preset.*`) so a
// doc that embeds a preset still matches the library copy by id + version.

import type { OverlayComponent, OverlayTheme } from './overlayTypes';

const TEXT = '$text';
const MUTED = '$muted';

export const PRESET_STEP_CARD: OverlayComponent = {
  id: 'preset.stepCard',
  name: 'Step card',
  version: 1,
  params: [{ key: 'showProgress', label: 'Show progress', type: 'toggle', default: true }],
  size: { width: 420, height: 'auto' },
  designHeight: 1080,
  root: {
    kind: 'box',
    id: 'root',
    style: {
      bg: '$bg',
      padding: [14, 18, 14, 18],
      radius: 10,
      shadow: 'md',
      border: { width: 1, color: '$surface', style: 'solid' },
      opacity: 0.94,
    },
    layout: { dir: 'col', gap: 8, align: 'stretch', justify: 'start' },
    children: [
      {
        kind: 'box',
        id: 'head',
        style: {},
        layout: { dir: 'row', gap: 10, align: 'center', justify: 'start' },
        children: [
          { kind: 'icon', id: 'ico', style: { size: 20, color: '$accent' }, icon: 'step' },
          {
            kind: 'text',
            id: 'num',
            style: { size: 13, weight: 600, color: '$accent' },
            text: 'STEP {{step.index}} / {{step.count}}',
            rich: false,
          },
        ],
      },
      {
        kind: 'text',
        id: 'title',
        style: { size: 22, weight: 700, color: TEXT, maxLines: 2 },
        text: '{{step.name}}',
        rich: false,
      },
      { kind: 'divider', id: 'rule', style: { bg: '$surface' }, showIf: 'step.text' },
      {
        kind: 'text',
        id: 'desc',
        style: { size: 15, color: MUTED, maxLines: 6 },
        text: '{{step.text}}',
        rich: true,
        showIf: 'step.text',
      },
      {
        kind: 'progress',
        id: 'bar',
        style: { height: 5 },
        value: '{{step.index}}/{{step.count}}',
        showIf: 'showProgress',
      },
    ],
  },
};

export const PRESET_CALLOUT: OverlayComponent = {
  id: 'preset.callout',
  name: 'Callout',
  version: 1,
  params: [
    { key: 'title', label: 'Title', type: 'text', default: 'Callout' },
    { key: 'body', label: 'Text', type: 'richText', default: '' },
  ],
  size: { width: 'auto', height: 'auto' },
  designHeight: 1080,
  root: {
    kind: 'box',
    id: 'root',
    style: {
      bg: '$bg',
      padding: [8, 12, 8, 12],
      radius: 6,
      shadow: 'sm',
      border: { width: 1, color: '$accent', style: 'solid' },
    },
    layout: { dir: 'col', gap: 4, align: 'start', justify: 'start' },
    children: [
      { kind: 'text', id: 'title', style: { size: 16, weight: 600, color: TEXT }, text: '{{title}}', rich: false },
      {
        kind: 'text',
        id: 'body',
        style: { size: 13, color: MUTED, maxLines: 4 },
        text: '{{body}}',
        rich: true,
        showIf: 'body',
      },
    ],
  },
};

export const PRESET_CAPTION: OverlayComponent = {
  id: 'preset.caption',
  name: 'Caption bar',
  version: 1,
  params: [{ key: 'text', label: 'Caption', type: 'richText', default: '{{step.name}}' }],
  size: { width: 1200, height: 'auto' },
  designHeight: 1080,
  root: {
    kind: 'box',
    id: 'root',
    style: { bg: 'rgba(15,23,42,0.82)', padding: [12, 24, 12, 24], radius: 8 },
    layout: { dir: 'row', gap: 0, align: 'center', justify: 'center' },
    children: [
      {
        kind: 'text',
        id: 'cap',
        style: { size: 26, weight: 500, color: TEXT, align: 'center' },
        text: '{{text}}',
        rich: true,
      },
    ],
  },
};

export const PRESET_TITLE: OverlayComponent = {
  id: 'preset.titleCard',
  name: 'Title card',
  version: 1,
  params: [
    { key: 'title', label: 'Title', type: 'text', default: 'Assembly sequence' },
    { key: 'subtitle', label: 'Subtitle', type: 'text', default: '' },
  ],
  size: { width: 'auto', height: 'auto', minWidth: 360, maxWidth: 1200 },
  designHeight: 1080,
  root: {
    kind: 'box',
    id: 'root',
    style: { bg: '$bg', padding: [36, 48, 36, 48], radius: 14, shadow: 'lg' },
    layout: { dir: 'col', gap: 10, align: 'center', justify: 'center' },
    children: [
      {
        kind: 'text',
        id: 'title',
        style: { size: 48, weight: 700, color: TEXT, align: 'center' },
        text: '{{title}}',
        rich: false,
      },
      {
        kind: 'text',
        id: 'sub',
        style: { size: 22, color: MUTED, align: 'center' },
        text: '{{subtitle}}',
        rich: false,
        showIf: 'subtitle',
      },
    ],
  },
};

export const PRESET_INFO_IMAGE: OverlayComponent = {
  id: 'preset.infoImage',
  name: 'Info card with image',
  version: 1,
  params: [
    { key: 'title', label: 'Title', type: 'text', default: 'Detail' },
    { key: 'body', label: 'Text', type: 'richText', default: '' },
    { key: 'image', label: 'Image', type: 'image', default: null },
  ],
  size: { width: 480, height: 'auto' },
  designHeight: 1080,
  root: {
    kind: 'box',
    id: 'root',
    style: { bg: '$bg', padding: [12, 12, 12, 12], radius: 10, shadow: 'md' },
    layout: { dir: 'row', gap: 12, align: 'start', justify: 'start' },
    children: [
      {
        kind: 'image',
        id: 'img',
        style: { width: 140, height: 105, radius: 6 },
        src: '{{image}}',
        fit: 'cover',
        showIf: 'image',
      },
      {
        kind: 'box',
        id: 'col',
        style: { width: 'fill' },
        layout: { dir: 'col', gap: 6, align: 'stretch', justify: 'start' },
        children: [
          { kind: 'text', id: 'title', style: { size: 18, weight: 700, color: TEXT }, text: '{{title}}', rich: false },
          {
            kind: 'text',
            id: 'body',
            style: { size: 14, color: MUTED, maxLines: 6 },
            text: '{{body}}',
            rich: true,
            showIf: 'body',
          },
        ],
      },
    ],
  },
};

export const PRESET_WARNING: OverlayComponent = {
  id: 'preset.warning',
  name: 'Warning banner',
  version: 1,
  params: [{ key: 'text', label: 'Warning', type: 'richText', default: 'Caution' }],
  size: { width: 760, height: 'auto' },
  designHeight: 1080,
  root: {
    kind: 'box',
    id: 'root',
    style: { bg: '$warning', padding: [10, 18, 10, 18], radius: 8, shadow: 'md' },
    layout: { dir: 'row', gap: 12, align: 'center', justify: 'start' },
    children: [
      { kind: 'icon', id: 'ico', style: { size: 26, color: '#111827' }, icon: 'warning' },
      { kind: 'text', id: 'txt', style: { size: 18, weight: 600, color: '#111827' }, text: '{{text}}', rich: true },
    ],
  },
};

export const OVERLAY_PRESETS: readonly OverlayComponent[] = [
  PRESET_CALLOUT,
  PRESET_CAPTION,
  PRESET_TITLE,
  PRESET_STEP_CARD,
  PRESET_INFO_IMAGE,
  PRESET_WARNING,
];

export const DEFAULT_THEME: OverlayTheme = {
  id: 'theme.default',
  name: 'Dark',
  tokens: {
    bg: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    muted: '#cbd5e1',
    accent: '#38bdf8',
    warning: '#f59e0b',
    danger: '#ef4444',
    success: '#22c55e',
  },
};

export const LIGHT_THEME: OverlayTheme = {
  id: 'theme.light',
  name: 'Light',
  tokens: {
    bg: '#ffffff',
    surface: '#e2e8f0',
    text: '#0f172a',
    muted: '#475569',
    accent: '#0369a1',
    warning: '#fbbf24',
    danger: '#dc2626',
    success: '#16a34a',
  },
};

export const OVERLAY_THEME_PRESETS: readonly OverlayTheme[] = [DEFAULT_THEME, LIGHT_THEME];

/** The theme an overlay without one (Auto) is drawn with: the Light theme in
 *  the app's light theme, else Dark — the library's copy when `themes` has
 *  it (the user may have restyled it). */
export function autoTheme(app: 'dark' | 'light', themes: readonly OverlayTheme[] = []): OverlayTheme {
  const preset = app === 'light' ? LIGHT_THEME : DEFAULT_THEME;
  return themes.find((t) => t.id === preset.id) ?? preset;
}
