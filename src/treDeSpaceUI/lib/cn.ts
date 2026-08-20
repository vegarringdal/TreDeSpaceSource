import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge conditional class lists and resolve conflicting Tailwind utilities
 *  (the later class wins, e.g. `cn('px-2', cond && 'px-4')` → `px-4`).
 *  Biome's `useSortedClasses` sorts the literals inside `cn(...)`. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
