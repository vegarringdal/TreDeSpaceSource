import { IconChevronLeft, IconChevronRight, IconSlideshow } from '@tabler/icons-react';
import { Button } from '@treDeSpaceUI/widgets';
import { viewpointsActions as act } from '../../../state/viewer/viewpoints.actions';
import { viewpointViewerActions } from '../../../state/viewer/viewpointViewer.actions';

type ViewpointViewerNavProps = Readonly<{
  /** 0-based position of the active viewpoint, -1 when none is active */
  activeIndex: number;
  count: number;
  oneAtATime: boolean;
}>;

/** The Viewpoint Viewer's top row: the previous / next arrows around the
 *  "x / y" position (wide, so they are easy to hit and never wrap), and the
 *  switch between the whole list and one viewpoint at a time. */
export function ViewpointViewerNav({ activeIndex, count, oneAtATime }: ViewpointViewerNavProps) {
  const position = activeIndex >= 0 ? (activeIndex + 1).toLocaleString() : '–';

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-slate-800 border-b pb-1.5">
      <div className="flex min-w-36 flex-1 items-center gap-1.5">
        <Button
          iconOnly
          grow
          icon={<IconChevronLeft />}
          disabled={count === 0 || activeIndex === 0}
          tooltip="Previous: activate the viewpoint before the active one (the last one when none is active)"
          shortcut="viewpoints.prev"
          onClick={() => void act.step(-1)}
        />
        <span
          className="min-w-10 shrink-0 whitespace-nowrap text-center text-slate-300 text-xs tabular-nums"
          data-tooltip="The active viewpoint's place in the list / how many there are"
        >
          {position} / {count.toLocaleString()}
        </span>
        <Button
          iconOnly
          grow
          icon={<IconChevronRight />}
          disabled={count === 0 || activeIndex === count - 1}
          tooltip="Next: activate the viewpoint after the active one (the first one when none is active)"
          shortcut="viewpoints.next"
          onClick={() => void act.step(1)}
        />
      </div>
      <Button
        className="ml-auto"
        active={oneAtATime}
        icon={<IconSlideshow size={14} />}
        tooltip="Show only the active viewpoint instead of the whole list — step with the arrows"
        shortcut="viewpointViewer.oneAtATime"
        onClick={viewpointViewerActions.toggleOneAtATime}
      >
        One at a time
      </Button>
    </div>
  );
}
