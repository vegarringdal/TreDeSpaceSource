import type { ReactNode } from 'react';
import { RIBBON_HEIGHT, type RibbonSize } from './ribbonSizes';

/**
 * Puts any content into the ribbon's sizing system — the escape hatch for
 * inputs, selects, whatever. The content is vertically centred in its slot.
 */
export function RibbonSlot({
  size = 'medium',
  children,
  className = '',
}: {
  size?: RibbonSize;
  children?: ReactNode;
  className?: string;
}) {
  return <div className={`flex min-w-16 flex-col justify-center ${RIBBON_HEIGHT[size]} ${className}`}>{children}</div>;
}
