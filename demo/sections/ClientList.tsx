import { Checkbox } from '@treDeSpaceUI/widgets';
import type { ClientInfo } from '../../api/tredespace-client';
import { Hint } from '../components/Hint';

/** One line per connected client, tickable as a recipient for custom.post.
 *  Your own row is marked but not tickable — a sender never gets its own event. */
export function ClientList({
  clients,
  self,
  selected,
  onToggle,
}: Readonly<{
  clients: readonly ClientInfo[];
  self: string;
  selected: readonly string[];
  onToggle: (id: string, on: boolean) => void;
}>) {
  if (clients.length === 0) {
    return <Hint>No client list yet — run custom.clients (the list also refreshes on custom.clients.changed).</Hint>;
  }

  return (
    <div className="flex flex-col gap-0.5">
      {clients.map((cl) => {
        const isSelf = cl.id === self;
        const label = [cl.id, cl.kind, cl.name, cl.tag ? `#${cl.tag}` : undefined, cl.dialog]
          .filter(Boolean)
          .join(' · ');
        const hint = `${cl.origin}${cl.subscribed ? '' : ' · not subscribed'}${isSelf ? ' · you' : ''}`;
        return (
          <Checkbox
            key={cl.id}
            checked={selected.includes(cl.id)}
            onChange={(on) => onToggle(cl.id, on)}
            disabled={isSelf}
            label={label}
            hint={hint}
          />
        );
      })}
    </div>
  );
}
