// Every unsolicited event type the viewer posts. `app.ready` / `app.info`
// list them so a host can feature-detect, and `events.subscribe` accepts
// them. Pure (no app imports) so tests can pin the list against the source.

export const API_EVENTS = [
  'app.ready',
  'app.bye',
  'app.error',
  'theme.changed',
  'tree.select',
  'instance.changed',
  'dialog.changed',
  'viewpoints.bookmark',
  'assets.importUrl:progress',
  'assets.load:progress',
  'sql.importUrl:progress',
  'sql.execute:progress',
  'sql.color:progress',
  'sql.select:progress',
  'sql.table:progress',
  'custom.event',
  'custom.clients.changed',
] as const;

export type ApiEventType = (typeof API_EVENTS)[number];

export function isApiEvent(type: string): type is ApiEventType {
  return (API_EVENTS as readonly string[]).includes(type);
}

/** `app.*` is lifecycle (ready / bye / error): delivered to every client
 *  regardless of its subscription, since a host cannot subscribe before it
 *  knows the viewer is there. */
export function isLifecycleEvent(type: string): boolean {
  return type.startsWith('app.');
}
