import { Collapsible } from '@treDeSpaceUI/widgets';
import type { ReactNode } from 'react';

/** One collapsed-by-default demo section; long explanations go in the header's
 *  info popover. Collapsed by default so remounting (Collapse all) resets it. */
export function DemoSection({
  title,
  info,
  children,
}: Readonly<{ title: string; info?: ReactNode; children: ReactNode }>) {
  return (
    <Collapsible title={title} info={info} defaultOpen={false}>
      {children}
    </Collapsible>
  );
}
