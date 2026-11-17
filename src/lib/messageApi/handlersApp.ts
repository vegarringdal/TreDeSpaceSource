// The API's own commands: discovery (`app.info`) and the per-client event
// subscription (`events.subscribe`). See EVENTS.md → Handshake / Events.
import { isApiEvent } from './apiEvents';
import { clientOf, subscribeAppEvents } from './clients';
import { ApiError, type ApiHandler, strings } from './protocol';
import { readyPayload } from './transport';

export const appHandlers: Record<string, ApiHandler> = {
  'app.info': () => readyPayload(),

  'events.subscribe': ({ p, source }) => {
    const c = clientOf(source);
    if (!c) {
      throw new ApiError('internal', 'sending window is not a registered client');
    }
    const names = strings(p.events, 'events');
    return {
      events: subscribeAppEvents(c, names.filter(isApiEvent)),
      unknown: names.filter((n) => !isApiEvent(n)),
    };
  },
};
