import { IconPlus } from '@tabler/icons-react';
import { Fragment, type ReactNode, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { CardFlowLink } from './CardFlowLink';

export interface CardFlowConnector {
  /** id of the card on the left */
  from: string;
  /** id of the card right after it */
  to: string;
  /** chip text, e.g. "then", "together", "then +1s" */
  label: string;
  /** a branch (runs together with `from`) — drawn as a dashed chip */
  branch?: boolean;
}

export interface CardFlowProps<T> {
  /** the cards in order — left to right, wrapping */
  cards: readonly T[];
  /** a card's stable id — what the callbacks and `connectors` use */
  getId: (card: T) => string;
  /** draws one card; CardFlow wraps it in the focusable, draggable cell */
  renderCard: (card: T, state: { selected: boolean; dragging: boolean }) => ReactNode;
  /** chips between consecutive cards (looked up by from → to); a pair
   *  without one shows a plain "then" */
  connectors: readonly CardFlowConnector[];
  /** id of the selected card, or null */
  selected: string | null;
  /** a card was clicked */
  onSelect: (id: string) => void;
  /** double-click or Enter on a card */
  onOpen: (id: string) => void;
  /** a card dropped before the card at `toIndex` — an index into `cards` as
   *  it is now, the dragged card included (moving right, it ends up at
   *  `toIndex - 1`) — or on the trailing + (`toIndex` = `cards.length`) */
  onReorder: (id: string, toIndex: number) => void;
  /** the + between two cards or the trailing + (index = where the new card goes) */
  onInsert: (index: number) => void;
  /** given: a card's lower 30 % is a drop zone — a card dropped there ("together") */
  onDropOnto?: (id: string, target: string, zone: 'bottom') => void;
  /** a connector chip was clicked; `at` = the click's viewport position (a
   *  Menu anchor for your link popover) */
  onConnectorClick?: (from: string, to: string, at: { x: number; y: number }) => void;
  className?: string;
}

/**
 * A flow of cards — a storyboard: cards left to right, wrapping to rows,
 * with a chip between consecutive cards naming how they connect. Drag a card
 * to reorder, drop it on another card's lower edge to join it, + inserts.
 */
export function CardFlow<T>({
  cards,
  getId,
  renderCard,
  connectors,
  selected,
  onSelect,
  onOpen,
  onReorder,
  onInsert,
  onDropOnto,
  onConnectorClick,
  className = '',
}: CardFlowProps<T>) {
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; zone: 'before' | 'bottom' } | null>(null);

  const conn = (from: string, to: string) => connectors.find((c) => c.from === from && c.to === to);

  const handleDrop = (targetIndex: number, target: string, zone: 'before' | 'bottom') => {
    const id = dragId.current;
    dragId.current = null;
    setDragging(null);
    setOver(null);
    if (!id || id === target) {
      return;
    }
    if (zone === 'bottom' && onDropOnto) {
      onDropOnto(id, target, 'bottom');
      return;
    }
    onReorder(id, targetIndex);
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-y-3 p-2', className)}>
      {cards.map((card, i) => {
        const id = getId(card);
        const prev = i > 0 ? getId(cards[i - 1]) : null;
        const c = prev ? conn(prev, id) : undefined;
        return (
          <Fragment key={id}>
            {prev && (
              <CardFlowLink
                label={c?.label ?? 'then'}
                branch={c?.branch ?? false}
                onClick={(at) => onConnectorClick?.(prev, id, at)}
                onInsert={() => onInsert(i)}
              />
            )}
            <div
              role="button"
              tabIndex={0}
              draggable
              className={cn(
                'relative cursor-pointer outline-none',
                over?.id === id && over.zone === 'before' && 'border-sky-400 border-l-2',
                over?.id === id && over.zone === 'bottom' && 'border-sky-400 border-b-2',
              )}
              onClick={() => onSelect(id)}
              onDoubleClick={() => onOpen(id)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(id)}
              onDragStart={() => {
                dragId.current = id;
                setDragging(id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                setOver({ id, zone: onDropOnto && e.clientY > r.top + r.height * 0.7 ? 'bottom' : 'before' });
              }}
              onDrop={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                handleDrop(i, id, onDropOnto && e.clientY > r.top + r.height * 0.7 ? 'bottom' : 'before');
              }}
            >
              {renderCard(card, { selected: selected === id, dragging: dragging === id })}
            </div>
          </Fragment>
        );
      })}
      <button
        type="button"
        className="ml-2 flex h-10 w-10 cursor-pointer items-center justify-center border border-slate-700 border-dashed text-slate-500 hover:border-sky-400 hover:text-sky-300"
        data-tooltip="Add a card at the end"
        onClick={() => onInsert(cards.length)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          const id = dragId.current;
          dragId.current = null;
          if (id) {
            onReorder(id, cards.length);
          }
        }}
      >
        <IconPlus size={16} />
      </button>
    </div>
  );
}
