/** Joins semantic utility classes using the standard Shadcn helper. */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
/** Resolves conditional utilities without changing upstream component styles. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
