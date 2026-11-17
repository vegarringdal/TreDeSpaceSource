// The custom-event bus between connected pages (host page, panels, opened
// tabs): subscribe, post, list. See EVENTS.md → custom.* for the contracts.
import {
  type ClientEntry,
  clientOf,
  deliverCustomEvent,
  listClients,
  subscribeClient,
  unsubscribeClient,
} from './clients';
import {
  type Outcome,
  parseClientLabel,
  parseEventFilter,
  parseEventName,
  parseJsonData,
  parseTargets,
} from './customPayload';
import { ApiError, type ApiHandler } from './protocol';

function check<T>(o: Outcome<T>): T {
  if (!o.ok) {
    throw new ApiError('bad-payload', o.error);
  }
  return o.value;
}

/** Every dispatched message registered its window first, so this only fails
 *  on a programming error. */
function requireClient(source: Window | undefined): ClientEntry {
  const c = clientOf(source);
  if (!c) {
    throw new ApiError('internal', 'sending window is not a registered client');
  }
  return c;
}

export const customHandlers: Record<string, ApiHandler> = {
  'custom.subscribe': ({ p, source }) => {
    const c = requireClient(source);
    const name = check(parseClientLabel(p.name, 'name'));
    const tag = check(parseClientLabel(p.tag, 'tag'));
    subscribeClient(c, { name, tag }, check(parseEventFilter(p.events)));
    return { clientId: c.info.id };
  },

  'custom.unsubscribe': ({ source }) => {
    unsubscribeClient(requireClient(source));
    return {};
  },

  'custom.post': ({ p, source }) => {
    const c = requireClient(source);
    const event = check(parseEventName(p.event));
    const data = check(parseJsonData(p.data));
    const to = check(parseTargets(p.to));
    return deliverCustomEvent(c, event, data, to);
  },

  'custom.clients': ({ source }) => ({ self: requireClient(source).info.id, clients: listClients() }),
};
