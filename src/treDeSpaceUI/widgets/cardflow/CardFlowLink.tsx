import { IconArrowRight, IconPlus } from '@tabler/icons-react';
import { cn } from '../../lib/cn';

type Props = Readonly<{
  label: string;
  branch: boolean;
  onClick: (at: { x: number; y: number }) => void;
  onInsert: () => void;
}>;

/** The chip between two cards ("then", "together", …) with the + that
 *  inserts a card there (shown on hover). */
export function CardFlowLink({ label, branch, onClick, onInsert }: Props) {
  return (
    <div className="group/conn flex flex-col items-center px-1 text-[10px] text-slate-400">
      <button
        type="button"
        className={cn(
          'flex cursor-pointer items-center gap-0.5 whitespace-nowrap border px-1 py-0.5 hover:border-sky-400 hover:text-sky-200',
          branch ? 'border-slate-600 border-dashed' : 'border-slate-700',
        )}
        data-tooltip="Change how these connect"
        onClick={(e) => onClick({ x: e.clientX, y: e.clientY })}
      >
        {label} <IconArrowRight size={10} />
      </button>
      <button
        type="button"
        className="mt-0.5 cursor-pointer text-slate-600 opacity-0 hover:text-sky-300 group-hover/conn:opacity-100"
        data-tooltip="Insert a card here"
        onClick={onInsert}
      >
        <IconPlus size={12} />
      </button>
    </div>
  );
}
