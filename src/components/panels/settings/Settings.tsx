import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, VerticalTabs } from '@treDeSpaceUI/widgets';
import { dialogs } from '../../dialogs/dialogs.actions';
import { AboutTab } from './about/AboutTab';
import { AoTab } from './ao/AoTab';
import { EdgesTab } from './edges/EdgesTab';
import { EditorTab } from './editor/EditorTab';
import { ExternalTab } from './external/ExternalTab';
import { GizmoTab } from './gizmo/GizmoTab';
import { GpuTab } from './gpu/GpuTab';
import { LayoutsTab } from './layouts/LayoutsTab';
import { LightingTab } from './lighting/LightingTab';
import { NavigationTab } from './navigation/NavigationTab';
import { RenderingTab } from './rendering/RenderingTab';
import { settingsActions } from './settings.actions';
import { settingsTabState } from './settings.state';
import { ShortcutsSettings } from './shortcuts/ShortcutsSettings';
import { StatsTab } from './stats/StatsTab';

/** Settings panel shell: the vertical tab strip + the global reset. Each tab's
 *  content lives in its own component and reads its stores directly. */
export function Settings() {
  useMinSize(300, 200);

  return (
    <PanelBody className="panel-body flex h-full min-h-0 flex-col p-1 pr-2">
      <VerticalTabs
        className="min-h-0 flex-1"
        value={settingsTabState.use().tab}
        onChange={(id) => settingsTabState.set({ tab: id })}
        tabs={[
          { id: 'rendering', label: 'Rendering', content: <RenderingTab /> },
          { id: 'lighting', label: 'Lighting', content: <LightingTab /> },
          { id: 'gpu', label: 'GPU', content: <GpuTab /> },
          { id: 'navigation', label: 'Navigation', content: <NavigationTab /> },
          { id: 'edges', label: 'Edges', content: <EdgesTab /> },
          { id: 'ao', label: 'Ambient Occlusion', content: <AoTab /> },
          { id: 'gizmo', label: 'Gizmo', content: <GizmoTab /> },
          { id: 'shortcuts', label: 'Shortcuts', content: <ShortcutsSettings /> },
          { id: 'stats', label: 'Stats', content: <StatsTab /> },
          { id: 'editor', label: 'Editor', content: <EditorTab /> },
          { id: 'external', label: 'External', content: <ExternalTab /> },
          { id: 'layouts', label: 'Layouts', content: <LayoutsTab /> },
          { id: 'about', label: 'About', content: <AboutTab /> },
        ]}
      />
      <div className="flex shrink-0 justify-center border-slate-800 border-t pt-1.5 pb-0.5">
        <Button
          tooltip={
            'Reset Rendering, Lighting, GPU, Navigation, Edges, Ambient Occlusion, Gizmo, Stats, Editor, theme and custom Shortcuts to defaults.\n\nLayout slots and External apps are NOT touched — reset those from their own tabs.'
          }
          shortcut="settings.resetAll"
          onClick={() => {
            void dialogs
              .confirm(
                'Reset all settings to defaults? This covers Rendering, Lighting, GPU, Navigation, Edges, Ambient Occlusion, Gizmo, Stats, Editor, theme and your custom keyboard Shortcuts.\n\nLayout slots and External apps are left as-is.',
                { okLabel: 'Reset all' },
              )
              .then((ok) => ok && settingsActions.resetAll());
          }}
        >
          Reset all settings
        </Button>
      </div>
    </PanelBody>
  );
}
