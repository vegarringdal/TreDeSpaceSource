import { IconEyeDotted, IconEyeOff } from '@tabler/icons-react';
import type { Row } from './hierarchyModel';

type Props = Readonly<{ hidden: Row['hidden'] }>;

/** Eye badge at the end of a hierarchy row: 'all' = every item beneath is
 *  hidden; 'some' = partly hidden, so a collapsed parent (entry, folder or
 *  store band) still tells you something is hidden below. Hidden means the
 *  hide flag OR an opacity override of 0. */
export function HiddenBadge({ hidden }: Props) {
  if (!hidden) {
    return null;
  }
  return (
    <span
      className="ml-auto shrink-0 pl-1 text-slate-500"
      data-tooltip={
        hidden === 'all' ? 'Hidden (hide, or opacity 0)' : 'Some items below are hidden (hide, or opacity 0)'
      }
    >
      {hidden === 'all' ? <IconEyeOff size={12} /> : <IconEyeDotted size={12} />}
    </span>
  );
}
