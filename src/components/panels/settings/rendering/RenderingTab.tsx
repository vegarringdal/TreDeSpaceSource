import { AntialiasingSection } from './AntialiasingSection';
import { CullingSection } from './CullingSection';
import { DebugSection } from './DebugSection';
import { SelectionSection } from './SelectionSection';
import { VramBudgetSection } from './VramBudgetSection';

/** Settings → Rendering tab. */
export function RenderingTab() {
  return (
    <div className="flex flex-col gap-1.5">
      <AntialiasingSection />
      <CullingSection />
      <VramBudgetSection />
      <SelectionSection />
      <DebugSection />
    </div>
  );
}
