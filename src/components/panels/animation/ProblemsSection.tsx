import { IconAlertTriangle } from '@tabler/icons-react';
import { Button, Collapsible, EmptyState } from '@treDeSpaceUI/widgets';
import { describeProblem } from '../../../lib/animation/problems';
import type { Scene } from '../../../lib/animation/types';
import { goToProblem } from '../../../state/animation/problems';
import { problemsState } from '../../../state/animation/problems.state';

/** The scene's Problems list (DESIGN.md › Animation › Evaluation) with Go to
 *  per entry. */
export function ProblemsSection({ scene }: { scene: Scene }) {
  const problems = problemsState.useSelect((s) => s.problems);
  const nameOf = (id: string) =>
    scene.objects.find((o) => o.id === id)?.name || scene.callouts.find((c) => c.id === id)?.instance || id;

  return (
    <Collapsible title="Problems" aside={problems.length ? `⚠ ${problems.length}` : '0'}>
      {problems.length === 0 ? (
        <EmptyState>No problems — every object's items are found and nothing moves while hidden.</EmptyState>
      ) : (
        <div className="flex flex-col gap-1 text-xs">
          {problems.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: problems are recomputed and positional
            <div key={`${p.kind}-${i}`} className="flex items-start gap-1.5">
              <IconAlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
              <span className="min-w-0 flex-1 text-slate-300">{describeProblem(p, nameOf)}</span>
              <Button
                size="xs"
                tooltip="Pick what this problem is about"
                // the hotkey goes to the first problem
                shortcut={i === 0 ? 'animation.problem.goto' : undefined}
                onClick={() => goToProblem(p)}
              >
                Go to
              </Button>
            </div>
          ))}
        </div>
      )}
    </Collapsible>
  );
}
