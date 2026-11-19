import { Button, Checkbox, NumberInput } from '@treDeSpaceUI/widgets';
import { navActions, navState } from '../../../../state/viewer/nav.state';
import { spaceMouseActions } from '../../../../state/viewer/spaceMouse.actions';
import { type SpaceMouseStatus, spaceMouseState } from '../../../../state/viewer/spaceMouse.state';

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function describeStatus(status: SpaceMouseStatus): string {
  switch (status.kind) {
    case 'unsupported':
      return 'This browser has no WebHID — use Chrome or Edge.';
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return `Connected: ${status.deviceName}`;
    case 'disconnected':
      return status.error ?? 'Not connected';
  }
}

// -----------------------------------------------------------------------------
// Event handlers
// -----------------------------------------------------------------------------

function handleConnect(): void {
  void spaceMouseActions.connect();
}

function handleDisconnect(): void {
  void spaceMouseActions.disconnect();
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** Settings → Navigation → SpaceMouse: pairing and fly tuning for a 3Dconnexion device. */
export function SpaceMouseSettings() {
  const { status } = spaceMouseState.use();
  const nav = navState.use();
  const isConnected = status.kind === 'connected';

  return (
    <>
      <div className="mt-2 text-slate-400 text-xs">SpaceMouse (3Dconnexion)</div>
      <div className="flex items-center gap-2">
        <Button
          onClick={isConnected ? handleDisconnect : handleConnect}
          disabled={status.kind === 'unsupported' || status.kind === 'connecting'}
        >
          {isConnected ? 'Disconnect' : 'Connect…'}
        </Button>
        <span className="text-slate-400 text-xs">{describeStatus(status)}</span>
      </div>
      <div className="text-slate-500 text-xs">
        Push to fly, lift/press to rise/sink, twist/tilt to look. Using it switches to fly mode. The buttons act on the
        screen centre: left selects, right flies there (like Space+click). Speed follows the fly/walk speed above.
      </div>
      <NumberInput
        label="SpaceMouse look sensitivity"
        labelPosition="split"
        value={nav.spaceLookSens}
        min={0.1}
        max={5}
        step={0.1}
        unit="×"
        onChange={(x) => navActions.update({ spaceLookSens: x })}
      />
      <NumberInput
        label="SpaceMouse deadzone"
        labelPosition="split"
        value={nav.spaceDeadzone}
        min={0}
        max={0.9}
        step={0.05}
        onChange={(x) => navActions.update({ spaceDeadzone: x })}
      />
      <Checkbox
        label="Dominant axis only"
        checked={nav.spaceDominant}
        onChange={(x) => navActions.update({ spaceDominant: x })}
      />
      <Checkbox
        label="Invert forward/back"
        checked={nav.spaceInvertForward}
        onChange={(x) => navActions.update({ spaceInvertForward: x })}
      />
      <Checkbox
        label="Invert look up/down"
        checked={nav.spaceInvertPitch}
        onChange={(x) => navActions.update({ spaceInvertPitch: x })}
      />
      <Checkbox
        label="Invert turn left/right"
        checked={nav.spaceInvertYaw}
        onChange={(x) => navActions.update({ spaceInvertYaw: x })}
      />
      <Checkbox
        label="Centre crosshair while in use"
        checked={nav.spaceCrosshair}
        onChange={(x) => navActions.update({ spaceCrosshair: x })}
      />
      <NumberInput
        label="Crosshair fades after"
        labelPosition="split"
        value={nav.spaceCrosshairHoldSec}
        min={0.5}
        max={30}
        step={0.5}
        unit="s"
        onChange={(x) => navActions.update({ spaceCrosshairHoldSec: x })}
      />
    </>
  );
}
