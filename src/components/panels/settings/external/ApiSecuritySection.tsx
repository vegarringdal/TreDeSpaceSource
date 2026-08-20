import { Button, Collapsible, TextInput } from '@treDeSpaceUI/widgets';
import { apiSecurityState } from '../../../../state/apiSecurity.state';
import { Check } from '../Check';

/** External → API security: postMessage master switch + origin allowlist. */
export function ApiSecuritySection() {
  const apiSec = apiSecurityState.use();

  return (
    <Collapsible
      title="API security"
      info={
        <>
          Embedding pages can never touch the app's HTML or globals — the browser isolates cross-origin frames. The{' '}
          <b>postMessage API</b> (EVENTS.md) is the only channel, limited to the validated command list. These settings
          control which origins may use it. Same-origin and configured External apps are always allowed while the API is
          enabled.
        </>
      }
    >
      <Check
        label="Enable postMessage API"
        tooltip="Master switch — when off, all API messages are ignored"
        shortcut="api.enabled"
        checked={apiSec.enabled}
        onChange={(x) => apiSecurityState.set({ enabled: x })}
      />
      <Check
        label="Allow ?apiOrigins= URL parameter"
        tooltip="Let the embedding URL allowlist its own origin; disable for a strict settings-only allowlist"
        shortcut="api.urlparam"
        checked={apiSec.allowUrlParam}
        onChange={(x) => apiSecurityState.set({ allowUrlParam: x })}
      />
      {apiSec.origins.map((o, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional list of plain strings
        <div key={i} className="flex items-center gap-1.5">
          <TextInput
            value={o}
            placeholder="https://portal.example.com"
            onChange={(v) =>
              apiSecurityState.set({
                origins: apiSec.origins.map((x, j) => (j === i ? v.trim().replace(/\/+$/, '') : x)),
              })
            }
          />
          <Button
            tooltip="Remove this allowed origin"
            onClick={() => apiSecurityState.set({ origins: apiSec.origins.filter((_, j) => j !== i) })}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        className="self-start"
        tooltip="Add an allowed origin (scheme + host, no path)"
        shortcut="api.origin.add"
        onClick={() => apiSecurityState.set({ origins: [...apiSec.origins, ''] })}
      >
        Add allowed origin
      </Button>
    </Collapsible>
  );
}
