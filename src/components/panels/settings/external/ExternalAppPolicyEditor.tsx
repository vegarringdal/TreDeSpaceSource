import {
  isViewerOriginUrl,
  PERMISSION_OPTIONS,
  type PolicyOptionDoc,
  SANDBOX_OPTIONS,
  togglePolicyOption,
  VIEWER_ORIGIN_WARNING,
} from '../../../../state/externalAppPolicy';
import { type ExternalApp, externalAppsActions } from '../../../../state/externalApps.state';
import { Check } from '../Check';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface PolicyRowProps<T extends string> {
  caption: string;
  tooltip: string;
  options: readonly PolicyOptionDoc<T>[];
  selected: readonly T[] | undefined;
  onChange: (next: T[]) => void;
}

// -----------------------------------------------------------------------------
// Render
// -----------------------------------------------------------------------------

/** One captioned row of policy checkboxes, in the options' declared order. */
function PolicyRow<T extends string>({ caption, tooltip, options, selected, onChange }: PolicyRowProps<T>) {
  const current = new Set(selected ?? []);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-20 shrink-0 text-slate-400 text-xs" data-tooltip={tooltip}>
        {caption}
      </span>
      {options.map((o) => (
        <Check
          key={o.value}
          label={o.label}
          tooltip={o.tooltip}
          checked={current.has(o.value)}
          onChange={(on) => onChange(togglePolicyOption(selected, options, o.value, on))}
        />
      ))}
    </div>
  );
}

/** Per-app iframe policy: sandbox opt-ins and delegated browser permissions,
 *  every one off unless ticked, plus a warning when the URL shares the
 *  viewer's origin (where no sandbox can keep the page out). */
export function ExternalAppPolicyEditor({ app }: { app: ExternalApp }) {
  return (
    <>
      {isViewerOriginUrl(app.url) && (
        <div className="text-amber-400 text-xs">{VIEWER_ORIGIN_WARNING} Only add tools you fully trust here.</div>
      )}
      <PolicyRow
        caption="Sandbox"
        tooltip="Extra sandbox flags for the page. The base (scripts on its own origin, forms, downloads) is always on; top navigation is never offered."
        options={SANDBOX_OPTIONS}
        selected={app.sandbox}
        onChange={(v) => externalAppsActions.update(app.id, { sandbox: v })}
      />
      <PolicyRow
        caption="Permissions"
        tooltip="Browser features delegated to the page (iframe allow). The permission prompt names THIS viewer's origin, and a viewer that is itself embedded can only pass on what its own host granted it."
        options={PERMISSION_OPTIONS}
        selected={app.allow}
        onChange={(v) => externalAppsActions.update(app.id, { allow: v })}
      />
    </>
  );
}
