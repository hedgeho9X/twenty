/** Shares accessible native result controls styled with the current Twenty theme. */
import {
  type CSSProperties,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import { themeCssVariables as theme } from 'twenty-ui/theme';
const controlStyle: CSSProperties = {
  minHeight: 32,
  border: `1px solid ${theme.border.color.medium}`,
  borderRadius: theme.border.radius.sm,
  background: theme.background.primary,
  color: theme.font.color.primary,
  font: 'inherit',
  padding: '6px 10px',
  boxSizing: 'border-box',
};
/** Preserves standard input semantics for search, date and page-number fields. */
export const ResultInput = ({
  style,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} style={{ ...controlStyle, ...style }} />
);
/** Keeps keyboard and screen-reader selection behavior for table filters. */
export const ResultSelect = ({
  style,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} style={{ ...controlStyle, ...style }} />
);
