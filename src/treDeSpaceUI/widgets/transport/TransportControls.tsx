import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconPlayerStopFilled,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Button } from '../Button';
import type { MenuEntry } from '../menu/Menu';
import { SplitButton } from './SplitButton';

export type TransportStatus = 'stopped' | 'playing' | 'paused' | 'waiting';

export interface TransportControlsProps {
  /** Drives the main button: Play (stopped), Pause (playing), Continue
   *  (paused, or waiting at a stop point). */
  status: TransportStatus;
  /** The main button: play, pause or continue — `status` is yours to update. */
  onPlayPause: () => void;
  /** Omitted = no stop button. Disabled while `status` is 'stopped'. */
  onStop?: () => void;
  /** Previous part / step; omitted = no button. */
  onPrev?: () => void;
  /** Next part / step; omitted = no button. */
  onNext?: () => void;
  /** Hotkey ids per button (tooltip combo footers). */
  shortcuts?: { playPause?: string; stop?: string; prev?: string; next?: string };
  /** Alternatives under the main button's chevron (e.g. how Continue treats
   *  the camera); the chevron's tooltip is "Continue options". Without it
   *  the main button is a plain button. */
  playMenu?: readonly MenuEntry[];
  /** Tooltips per button (defaults describe the action). */
  tooltips?: { playPause?: string; stop?: string; prev?: string; next?: string };
  /** 'md' for panels; 'lg' gives 40 px touch targets (mini-players on tablets). */
  size?: 'md' | 'lg';
  /** Disables every transport button (not `children`). */
  disabled?: boolean;
  /** Extra controls after the transport (speed, loop…). */
  children?: ReactNode;
  className?: string;
}

const LABEL: Readonly<Record<TransportStatus, string>> = {
  stopped: 'Play',
  playing: 'Pause',
  paused: 'Continue',
  waiting: 'Continue',
};

/**
 * Media transport: previous · play/pause/continue · next · stop. Pure
 * presentation — the caller owns the status and the actions. The main
 * button's label follows `status`, and `playMenu` turns it into a
 * SplitButton for "continue how?" choices.
 */
export function TransportControls({
  status,
  onPlayPause,
  onStop,
  onPrev,
  onNext,
  shortcuts = {},
  playMenu,
  tooltips = {},
  size = 'md',
  disabled = false,
  children,
  className = '',
}: TransportControlsProps) {
  const playIcon = status === 'playing' ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />;
  const playTip = tooltips.playPause ?? `${LABEL[status]} playback`;

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {onPrev && (
        <Button
          iconOnly
          size={size}
          icon={<IconPlayerSkipBackFilled />}
          disabled={disabled}
          tooltip={tooltips.prev ?? 'Previous'}
          shortcut={shortcuts.prev}
          onClick={onPrev}
        />
      )}
      {playMenu ? (
        <SplitButton
          label={LABEL[status]}
          icon={playIcon}
          size={size}
          disabled={disabled}
          tooltip={playTip}
          shortcut={shortcuts.playPause}
          menuTooltip="Continue options"
          menu={playMenu}
          onClick={onPlayPause}
        />
      ) : (
        <Button
          size={size}
          className="min-w-20"
          icon={playIcon}
          disabled={disabled}
          tooltip={playTip}
          shortcut={shortcuts.playPause}
          onClick={onPlayPause}
        >
          {LABEL[status]}
        </Button>
      )}
      {onNext && (
        <Button
          iconOnly
          size={size}
          icon={<IconPlayerSkipForwardFilled />}
          disabled={disabled}
          tooltip={tooltips.next ?? 'Next'}
          shortcut={shortcuts.next}
          onClick={onNext}
        />
      )}
      {onStop && (
        <Button
          iconOnly
          size={size}
          icon={<IconPlayerStopFilled />}
          disabled={disabled || status === 'stopped'}
          tooltip={tooltips.stop ?? 'Stop and go to the start'}
          shortcut={shortcuts.stop}
          onClick={onStop}
        />
      )}
      {children}
    </div>
  );
}
