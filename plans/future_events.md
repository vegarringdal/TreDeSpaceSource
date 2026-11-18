# Host API backlog — commands and events to add later (PLANNED, not scheduled)

> **Status: backlog, started 2026-11-18.** Nothing here is built. Each entry
> sketches a postMessage command or event we expect to need, with sample
> code in the shape the real API uses, so whoever builds it starts from a
> concrete proposal. Add new entries as they come up. When one is built,
> move its text into EVENTS.md and the SDK and delete it here.
> `EVENTS.md › Future (documented, not v1)` keeps its one-line list
> (`viewpoints.activate`, `export.glb`/`export.ifc`, `selection.changed`,
> `model.loaded`); detailed sketches live here.

## How a new command or event is added

The checklist the existing ones follow:

- **Command:**
  1. Write a handler in `src/lib/messageApi/handlers<Domain>.ts`; a new file is also registered in `index.ts`.
  2. Add an SDK method in `api/tredespace-client.ts` that calls `this.send('<name>', …)`, **with JSDoc**.
  3. Add a `### <name>` section to EVENTS.md's command catalog with a ` ```js ` payload/response example.

  `vite build` fails without steps 2 and 3, and `tests/apiParity.test.ts` checks that EVENTS.md, the handler table and the SDK name the same commands.
- **Event:**
  1. Add the name to `API_EVENTS` (`src/lib/messageApi/apiEvents.ts`).
  2. Emit it with `emitApiEvent('<name>', payload)`. Stores do this through a small `install…Events()` called from `index.ts`, like `installHotkeyEvents`.
  3. In the SDK, add a payload interface, its entry in the event map and an `on<Name>()` helper.
  4. Add a `### <name>` section under EVENTS.md › Events.
- **Errors:** use `ApiError` with an `ApiErrorCode` from `wire.ts` (`bad-payload`, `not-ready`, `busy`, `not-found`, `download`, `sql`, `cancelled`, `internal`).
- **Naming:** commands are `domain.verb`. Events are `domain.changed` (or `domain.xChanged`). The payload names what changed and the host re-reads the details, as `hotkeys.changed` does.

---

## 1. `visibility.tempIsolate` (command)

**Why:** the Hierarchy toolbar's temporary isolate (`viewerActions.toggleTempIsolate`, `modeldb/tempIsolate.ts`) has no API. A host that drives the viewer, for example "show me this system while I review it", would select with `selection.set`, then isolate, then later put everything back the same way.

**Shape:** `on: true | false` sets the state; leaving `on` out toggles it. The reply is the state afterwards. Turning it on needs a selection.

```js
payload:  { on: true }       // isolate the current selection
response: { active: true }
payload:  { on: false }      // put back exactly what it hid
response: { active: false }
payload:  {}                 // toggle
response: { active: true }
```

```ts
// api/tredespace-client.ts
/** Temporary isolate (the Hierarchy toolbar's toggle): `on: true` hides
 *  everything not selected, `on: false` shows again exactly what it hid —
 *  colours set and parts hidden meanwhile stay. Leave `on` out to toggle.
 *  Turning it on needs a selection (`selectionSet` first). */
visibilityTempIsolate(opts: { on?: boolean } = {}): Promise<Result<{ active: boolean }>> {
  return this.send('visibility.tempIsolate', { ...opts });
}
```

```ts
// src/lib/messageApi/handlersVisibility.ts (new file, registered in index.ts)
export const visibilityHandlers: Record<string, ApiHandler> = {
  'visibility.tempIsolate': async ({ p }) => {
    if (p.on !== undefined && typeof p.on !== 'boolean') {
      throw new ApiError('bad-payload', 'on must be true, false or left out (toggle)');
    }
    const isActive = tempIsolateState.get().isActive;
    const want = typeof p.on === 'boolean' ? p.on : !isActive;
    if (want !== isActive) {
      if (want && selectionState.get().count === 0) {
        throw new ApiError('not-found', 'nothing is selected — select with selection.set first');
      }
      await viewerActions.toggleTempIsolate();
    }
    return { active: tempIsolateState.get().isActive };
  },
};
```

```js
// host
await viewer.selectionSet({ fullnames: ['/SITE-A/ZONE-1/PUMP-101'] });
await viewer.visibilityTempIsolate({ on: true });
// … colour it, hide parts, take a screenshot …
await viewer.visibilityTempIsolate({ on: false });
```

## 2. `tempIsolate.changed` (event)

**Why:** the user can switch the temporary isolate on or off from the toolbar or with `ALT 805`. It also switches off on its own when models are removed or a snapshot is applied. A host that mirrors it in its own UI needs to hear about it.

```js
{ tredespace: 1, id: null, type: 'tempIsolate.changed', ok: true,
  payload: { active: false } }
```

```ts
// src/lib/messageApi/handlersVisibility.ts — installed from index.ts
export function installTempIsolateEvents() {
  let prev = tempIsolateState.get().isActive;
  tempIsolateState.subscribe(() => {
    const active = tempIsolateState.get().isActive;
    if (active !== prev) {
      prev = active;
      emitApiEvent('tempIsolate.changed', { active });
    }
  });
}
```

```ts
// SDK
/** `tempIsolate.changed`: the temporary isolate went on or off (toolbar,
 *  hotkey, API, or dropped because models were removed / a snapshot applied). */
export interface TempIsolateChangedEvent {
  active: boolean;
}
onTempIsolateChanged(handler: (e: TempIsolateChangedEvent) => void, opts?: SubscribeOptions): () => void {
  return this.on('tempIsolate.changed', (p) => handler(p as TempIsolateChangedEvent), opts);
}
```

## 3. `visibility.isolate` / `visibility.hide` / `visibility.unhideAll` (commands)

**Why:** none of the plain visibility actions are in the API. The viewer has them (`viewerActions.isolateSelection`, `hideSelection`, `unhideAll`), and each is one undo step. They act on the current selection, so a host selects first, as for colouring.

```js
payload:  {}                          // visibility.isolate: hide everything not selected
response: { hidden: 182340 }          // items hidden by this call
payload:  {}                          // visibility.hide: hide the selection
response: { hidden: 12 }
payload:  {}                          // visibility.unhideAll
response: { shown: 182352 }
```

The counts need the worker calls to report how many items they changed; today they return only the state updates. Without counts, `{}` is a fine first reply.

## 4. `settings.changed` (event)

**Why:** a host that saves a user's own preferences (for example whether they switched the navigation gizmo from the default axis balls to the cube) can already read `settings.get`, but cannot tell *when* something changed. The user changes settings in Settings, with the gizmo's right-click / long-press, and through hotkeys.

**Shape:** like `hotkeys.changed`, it names what changed and the host re-reads it. `keys` are viewer-state keys, and `tab` is the `settings.<tab>.set` group they belong to, when there is one.

```js
{ tredespace: 1, id: null, type: 'settings.changed', ok: true,
  payload: { keys: ['gizmoStyle'], tab: 'gizmo' } }
```

```ts
// src/lib/messageApi/handlersSettings.ts — installed from index.ts
export function installSettingsEvents() {
  let prev = viewerState.get();
  viewerState.subscribe(() => {
    const next = viewerState.get();
    const keys = (Object.keys(next) as (keyof ViewerState)[]).filter(
      (k) => next[k] !== prev[k] && !TRANSIENT_KEYS.has(k),
    );
    prev = next;
    if (keys.length) {
      emitApiEvent('settings.changed', { keys, tab: tabOf(keys) }); // tabOf: from SETTINGS_TAB_KEYS
    }
  });
}
```

```js
// host
viewer.onSettingsChanged(async ({ keys }) => {
  if (keys.includes('gizmoStyle')) {
    const { viewer: s } = await viewer.settingsGet();
    saveUserPreference('gizmoStyle', s.gizmoStyle);
  }
});
```

**Open:**
- **Leave out per-session keys** (`orthographic`, `sketch`, …), the same ones settings files skip.
- **Batch bursts** (a settings-file load, Reset all) into one event.
- **Face names** live in their own store (`gizmoLabels.state.ts`). Either a second subscription reports them as `keys: ['labels'], tab: 'gizmo'`, or they get their own event.

## 5. True north from the model (`model.loaded` field)

**Why:** an IFC file can carry its true north (`IfcGeometricRepresentationContext.TrueNorth`). Today a host sets the gizmo's `northAngle` by hand per project with `settings.gizmo.set`. When the converter reads the angle (`plans/navigation_gizmo.md`, phase 3), the host should get it too. Then it can apply it or ask the user, and the viewer doesn't silently change a project setting.

**Shape:** an extra field on the `model.loaded` event already listed in EVENTS.md › Future. It is `null` when the file has no north (RVM, STEP, GLB).

```js
{ tredespace: 1, id: null, type: 'model.loaded', ok: true,
  payload: { model: 3, name: 'building.ifc', group: 'Arch', northAngle: 32.5 } }
```

```js
// host: follow the model's own north for this project
viewer.onModelLoaded(({ northAngle }) => {
  if (northAngle !== null) {
    viewer.settingsGizmoSet({ northAngle, gizmoNorthMarker: true });
  }
});
```

**Needs:** the IFC converter has to read the angle and the cooked metadata has to carry it. That is a Rust change, so the wasm is rebuilt with its `build-info.json`.

---

## Ideas not sketched yet

- **`nav.gizmo.resetPosition`:** put the navigation gizmo back in its corner (the drag handle's Shift+click), for hosts that rearrange the layout.
- **`nav.faceNorth`:** turn the camera to look toward true north, keeping the tilt.
