// Public surface of `@tredespace/ui/lib`: the tiny store the whole state
// design is built on (README → "State placement"), and the class-merging
// helper every widget uses. Kept as its own entry so a consumer can adopt the
// store pattern without pulling the widgets in.
export * from './cn';
export * from './createStore';
