import { createStore } from '@treDeSpaceUI/lib/createStore';

/** SpaceMouse connection status (runtime only — the user's tuning lives in nav.state). */
export type SpaceMouseStatus =
  | Readonly<{ kind: 'unsupported' }>
  | Readonly<{ kind: 'disconnected'; error: string | null }>
  | Readonly<{ kind: 'connecting' }>
  | Readonly<{ kind: 'connected'; deviceName: string }>;

export type SpaceMouseState = Readonly<{
  status: SpaceMouseStatus;
}>;

export const spaceMouseState = createStore<SpaceMouseState>({
  status: { kind: 'disconnected', error: null },
});
