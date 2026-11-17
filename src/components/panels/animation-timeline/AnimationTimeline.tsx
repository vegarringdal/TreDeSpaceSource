// The Timeline panel (DESIGN.md › Animation › Authoring): everything while
// animating — the toolbar (scene, objects and keys, transport, view,
// export) over the rows: Steps, Camera, Section, Colour rules, Callouts and
// one row per object, with key diamonds, bars between moving keys and
// hatched hidden spans.
import { IconMovie } from '@tabler/icons-react';
import { PanelBody, useMinSize } from '@treDeSpaceUI/dockable';
import { Button, EmptyState, Menu, Timeline, type TimelineRow } from '@treDeSpaceUI/widgets';
import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from 'react';
import { sceneView } from '../../../lib/animation/scene';
import { formatTime } from '../../../lib/animation/timeFormat';
import { animationDocState } from '../../../state/animation/animationDoc.state';
import { animationUiActions } from '../../../state/animation/animationUi.actions';
import { animationUiState } from '../../../state/animation/animationUi.state';
import { activeScene } from '../../../state/animation/docEdit';
import { playerActions } from '../../../state/animation/player.actions';
import { playerState } from '../../../state/animation/player.state';
import { findComponent } from '../../../state/animation/runtimeOverlay';
import { DraftBanner } from './DraftBanner';
import { PlaybackOnlyBar } from './PlaybackOnlyBar';
import { TimelineRowName } from './TimelineRowName';
import { TimelineToolbar } from './TimelineToolbar';
import { timelineEditActions } from './timelineEdit.actions';
import { CALLOUT_ROW, calloutItemId } from './timelineIds';
import { buildTimeline } from './timelineModel';
import { useTimelineMenu } from './useTimelineMenu';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------

const GRID_S = 0.5;
/** The ruler shows at least this long a scene (s). */
const MIN_RULER_S = 10;

// -----------------------------------------------------------------------------
// component
// -----------------------------------------------------------------------------

/** The animation Timeline. */
export function AnimationTimeline() {
  useMinSize(320, 120);

  // ---------------------------------------------------------------------------
  // hooks
  // ---------------------------------------------------------------------------

  const ui = animationUiState.use();
  const p = playerState.use();
  const doc = animationDocState.use().doc;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const menu = useTimelineMenu();
  const scene = activeScene(doc);
  const view = scene ? sceneView(scene) : null;
  const model = useMemo(
    () =>
      scene && view
        ? buildTimeline(scene, ui.picked, view.duration, collapsed, (c) => {
            const inst = doc.overlayInstances.find((i) => i.id === c.instance);
            const kind = (inst && findComponent(doc, inst.component)?.name) || 'Overlay';
            const title = inst?.values.title ?? inst?.values.text;
            return typeof title === 'string' && title ? `${kind} · ${title}` : kind;
          })
        : null,
    [scene, view, ui.picked, collapsed, doc],
  );

  // ---------------------------------------------------------------------------
  // derived state
  // ---------------------------------------------------------------------------

  const editing = ui.mode.kind === 'author';
  const snap = useMemo(
    () => ({ enabled: ui.snap, step: GRID_S, targets: [...(model?.snapTargets ?? []), p.time] }),
    [ui.snap, model, p.time],
  );
  const rows: TimelineRow[] = (model?.rows ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    depth: r.depth,
    tint: r.tint,
    collapsible: r.collapsible,
    collapsed: r.collapsed,
    label: (
      <TimelineRowName
        name={r.name}
        row={r.row}
        current={r.row !== null && r.row === ui.current}
        selected={r.row !== null && ui.objectSelection.some((id) => r.row === `o:${id}`)}
        muted={r.muted}
        onPick={
          r.id.startsWith(CALLOUT_ROW)
            ? () =>
                timelineEditActions.select(
                  { items: [calloutItemId(r.id.slice(CALLOUT_ROW.length))], points: [] },
                  false,
                )
            : undefined
        }
      />
    ),
  }));

  // ---------------------------------------------------------------------------
  // event handlers
  // ---------------------------------------------------------------------------

  const handleToggleRow = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) {
        n.delete(id);
      } else {
        n.add(id);
      }
      return n;
    });

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (timelineEditActions.handleKey(e, view?.duration ?? 0)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------

  if (p.status === 'off' || !scene || !view || !model) {
    return (
      <PanelBody className="flex flex-col">
        <DraftBanner />
        <EmptyState layout="center" icon={<IconMovie size={28} />}>
          <div className="flex flex-col items-center gap-2">
            <span>Turn on Animate, select items and press + Object — then pose them and Key.</span>
            <Button
              variant="primary"
              icon={<IconMovie />}
              tooltip="Enter animation authoring"
              shortcut="animation.toggleMode"
              onClick={() => void animationUiActions.enterAuthoring()}
            >
              Animate
            </Button>
          </div>
        </EmptyState>
      </PanelBody>
    );
  }

  return (
    <PanelBody className="flex h-full min-h-0 flex-col overflow-hidden">
      <DraftBanner />
      {!editing && <PlaybackOnlyBar />}
      <TimelineToolbar scene={scene} duration={view.duration} editing={editing} />
      <div className="flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
        <Timeline
          className="min-h-0 flex-1"
          rows={rows}
          items={model.items}
          points={model.points}
          playhead={p.time}
          duration={Math.max(MIN_RULER_S, view.duration)}
          endMark={view.duration}
          view={ui.view}
          range={ui.range}
          snap={snap}
          format={formatTime}
          labelWidth={ui.timelineLabelWidth}
          onLabelWidthChange={animationUiActions.setTimelineLabelWidth}
          onViewChange={(v) => animationUiActions.set({ view: v })}
          onSeek={playerActions.seek}
          onItemsMove={(ids, dt, _hint, phase) => timelineEditActions.moveItems(ids, dt, phase)}
          onItemResize={(id, edge, t, _shift, phase) => timelineEditActions.resizeItem(id, edge, t, phase)}
          onPointsMove={timelineEditActions.movePoints}
          onSelect={timelineEditActions.select}
          onToggleRow={handleToggleRow}
          onOpen={(t) => t.kind === 'row' && timelineEditActions.select({ items: [], points: [] }, false)}
          onContextMenu={menu.open}
          onRangeChange={(range) => animationUiActions.set({ range })}
        />
      </div>
      <Menu anchor={menu.anchor} items={menu.items} onClose={menu.close} />
    </PanelBody>
  );
}
