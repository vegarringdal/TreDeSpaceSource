// The keyboard-shortcut system: a dependency-free engine (sequences, parsing,
// display formatting, validation) plus a registry store with user overrides,
// persistence and keymap import/export. The Tooltip widget reads this registry
// for its shortcut footers.
export * from './engine';
export * from './hotkeys.state';
