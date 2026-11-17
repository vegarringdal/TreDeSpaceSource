import type { ReactNode } from 'react';

/**
 * Optional wrapper for panel content. Pass `className` to style it however you
 * like (Tailwind utilities work here — panels are plain DOM in your document,
 * no shadow root).
 */
export function PanelBody({
  children,
  className = 'panel-body',
  ref,
}: {
  children: ReactNode;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
