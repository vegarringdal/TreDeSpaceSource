import { cn } from '../../lib/cn';
import { formatTime, type Time } from './timeMath';

/** Which dial the popover is editing: an endpoint's hour or minute. */
export type TimeStage = Readonly<{ endpoint: 'start' | 'end'; mode: 'hour' | 'minute' }>;

export interface TimeDigitsProps {
  start: Time;
  /** Second endpoint — null renders the single-time header. */
  end: Time | null;
  stage: TimeStage;
  onStage: (stage: TimeStage) => void;
}

const DIGIT_CLS = 'cursor-pointer px-1 py-0.5 font-mono text-lg leading-none';

/** The popover's segmented HH:MM header (one or two endpoints); each digit
 *  pair is a button that switches the dial to that endpoint + mode. */
export function TimeDigits({ start, end, stage, onStage }: TimeDigitsProps) {
  const segment = (endpoint: 'start' | 'end', t: Time) => {
    const digit = (mode: 'hour' | 'minute') => (
      <button
        type="button"
        data-tooltip={`Pick ${endpoint === 'end' && end != null ? 'end ' : end != null ? 'start ' : ''}${mode}`}
        className={cn(
          DIGIT_CLS,
          stage.endpoint === endpoint && stage.mode === mode
            ? 'bg-blue-950 text-blue-100'
            : 'text-slate-400 hover:text-slate-200',
        )}
        onClick={() => onStage({ endpoint, mode })}
      >
        {formatTime(t).slice(mode === 'hour' ? 0 : 3, mode === 'hour' ? 2 : 5)}
      </button>
    );
    return (
      <span key={endpoint} className="flex items-center">
        {digit('hour')}
        <span className="font-mono text-lg text-slate-500 leading-none">:</span>
        {digit('minute')}
      </span>
    );
  };

  return (
    <div className="flex items-center justify-center gap-0.5 border-slate-700 border-b p-1.5">
      {segment('start', start)}
      {end != null && <span className="px-1 text-slate-500">–</span>}
      {end != null && segment('end', end)}
    </div>
  );
}
