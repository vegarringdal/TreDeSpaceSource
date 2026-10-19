import { CardFlow } from '@treDeSpaceUI/widgets';
import { useState } from 'react';
import { Section } from './Section';

type Card = { id: string; name: string };

/** Gallery section for CardFlow. */
export function CardFlowDemo() {
  const [cards, setCards] = useState<Card[]>([
    { id: 'a', name: 'Base frame' },
    { id: 'b', name: 'Pump skid' },
    { id: 'c', name: 'Motor' },
    { id: 'd', name: 'Piping' },
  ]);
  const [selected, setSelected] = useState<string | null>('b');
  const [log, setLog] = useState('');
  return (
    <Section
      title="CardFlow"
      note="A flow of cards — a storyboard: cards left to right, wrapping to rows, with a chip between consecutive cards naming how they connect (then / together / +gap; a pair without a connector reads 'then'). Click selects, double-click or Enter opens; drag a card to reorder (onReorder's index counts the dragged card), drop it on another card's lower edge to join it ('together'), + between cards or at the end inserts; a chip click opens your own link popover. You render the cards."
      props={['CardFlowProps', 'CardFlowConnector']}
      code={`// links, newPart(), focusPart(), linkTogether() and openLinkMenu() are yours
function Storyboard() {
  const [parts, setParts] = useState([{ id: 'a', name: 'Base frame' }, { id: 'b', name: 'Pump skid' }]);
  const [selected, setSelected] = useState<string | null>(null);
  // toIndex = the card it was dropped before, counted with the dragged card still in the list
  const move = (id: string, toIndex: number) =>
    setParts((ps) => {
      const from = ps.findIndex((p) => p.id === id);
      const rest = ps.filter((p) => p.id !== id);
      const at = from < toIndex ? toIndex - 1 : toIndex;
      return [...rest.slice(0, at), ps[from], ...rest.slice(at)];
    });
  return (
    <CardFlow
      cards={parts}
      getId={(p) => p.id}
      renderCard={(p, s) => <PartCard part={p} selected={s.selected} faded={s.dragging} />}
      connectors={links}
      selected={selected}
      onSelect={setSelected}
      onOpen={focusPart}
      onReorder={move}
      onInsert={(index) => setParts((ps) => [...ps.slice(0, index), newPart(), ...ps.slice(index)])}
      onDropOnto={(id, target) => linkTogether(id, target)}
      onConnectorClick={(from, to, at) => openLinkMenu(from, to, at)}
    />
  );
}`}
    >
      <CardFlow
        cards={cards}
        getId={(c) => c.id}
        connectors={cards
          .slice(1)
          .map((c, i) => ({ from: cards[i].id, to: c.id, label: i === 1 ? 'together' : 'then', branch: i === 1 }))}
        selected={selected}
        renderCard={(c, s) => (
          <div
            className={`w-28 border bg-slate-900 p-2 ${s.selected ? 'border-sky-400' : 'border-slate-700'} ${s.dragging ? 'opacity-40' : ''}`}
          >
            <div className="h-10 bg-slate-950" />
            <div className="mt-1 truncate">{c.name}</div>
          </div>
        )}
        onSelect={setSelected}
        onOpen={(id) => setLog(`open ${id}`)}
        onReorder={(id, to) =>
          setCards((cs) => {
            const from = cs.findIndex((x) => x.id === id);
            if (from < 0) {
              return cs;
            }
            // `to` counts the dragged card, which is removed first
            const at = from < to ? to - 1 : to;
            const rest = cs.filter((x) => x.id !== id);
            return [...rest.slice(0, at), cs[from], ...rest.slice(at)];
          })
        }
        onInsert={(i) =>
          setCards((cs) => [...cs.slice(0, i), { id: `n${Date.now()}`, name: 'New part' }, ...cs.slice(i)])
        }
        onDropOnto={(id, target) => setLog(`${id} together with ${target}`)}
        onConnectorClick={(from, to) => setLog(`link ${from} → ${to}`)}
      />
      <span className="text-slate-400">{log}</span>
    </Section>
  );
}
