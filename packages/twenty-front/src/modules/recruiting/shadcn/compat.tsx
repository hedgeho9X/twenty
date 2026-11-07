import {
  Tabs as TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
} from './ui/tabs';
/** Adapts the workbench's existing field contracts to genuine shadcn components. */
import * as React from 'react';
import { cn } from 'cn';
import { Alert, AlertDescription } from './ui/alert';
import { Spinner } from './ui/spinner';
import { Progress as ShadcnProgress } from './ui/progress';
import { Button as ShadcnButton } from './ui/button';
import { Input as ShadcnInput } from './ui/input';
import { Textarea as ShadcnTextarea } from './ui/textarea';
import { Checkbox as ShadcnCheckbox } from './ui/checkbox';
import { Badge as ShadcnBadge } from './ui/badge';
import {
  Field as ShadcnField,
  FieldLabel,
  FieldDescription,
  FieldError,
} from './ui/field';
import {
  Select as SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from './ui/select';
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogClose,
  DialogTrigger,
} from './ui/dialog';

type ButtonProps = Omit<
  React.ComponentProps<typeof ShadcnButton>,
  'variant' | 'size'
> & {
  variant?: string;
  size?: string;
  color?: string;
  loading?: boolean;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
  fullWidth?: boolean;
};
/** Preserves old action callbacks while using shadcn focus, disabled and variant behavior. */
export const Button = ({
  variant,
  size,
  color,
  loading,
  startIcon,
  endIcon,
  fullWidth,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) => (
  <ShadcnButton
    {...props}
    className={cn(fullWidth && 'w-full', className)}
    disabled={disabled || loading}
    variant={
      variant === 'ghost' || variant === 'tertiary'
        ? 'ghost'
        : variant === 'solid' || variant === 'primary' || color === 'accent'
          ? 'default'
          : variant === 'destructive' || color === 'danger'
            ? 'destructive'
            : 'outline'
    }
    size={size === 'lg' ? 'lg' : size === 'icon' ? 'icon' : 'sm'}
  >
    {loading ? <Spinner aria-label="加载中" /> : startIcon}
    {children}
    {endIcon}
  </ShadcnButton>
);
/** Keeps controlled input values independent of native change-event details. */
export const Input = ({
  onValueChange,
  onChange,
  ...props
}: React.ComponentProps<typeof ShadcnInput> & {
  onValueChange?: (value: string) => void;
}) => (
  <ShadcnInput
    {...props}
    onChange={(event) => {
      onValueChange?.(event.target.value);
      onChange?.(event);
    }}
  />
);
export const TextInput = ({
  onChange,
  ...props
}: Omit<React.ComponentProps<typeof ShadcnInput>, 'onChange'> & {
  onChange?: (value: string) => void;
}) => (
  <ShadcnInput
    {...props}
    onChange={(event) => onChange?.(event.target.value)}
  />
);
/** Keeps controlled textarea values compatible with existing editors. */
export const Textarea = ({
  onValueChange,
  onChange,
  ...props
}: React.ComponentProps<typeof ShadcnTextarea> & {
  onValueChange?: (value: string) => void;
}) => (
  <ShadcnTextarea
    {...props}
    onChange={(event) => {
      onValueChange?.(event.target.value);
      onChange?.(event);
    }}
  />
);
export const Checkbox = ({
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<typeof ShadcnCheckbox>, 'onCheckedChange'> & {
  onCheckedChange?: (checked: boolean) => void;
}) => (
  <ShadcnCheckbox
    {...props}
    onCheckedChange={(value) => onCheckedChange?.(value === true)}
  />
);
export const Field = {
  Root: ShadcnField,
  Item: ({ children, ...props }: React.ComponentProps<typeof ShadcnField>) => (
    <ShadcnField {...props} orientation="horizontal">
      {children}
    </ShadcnField>
  ),
  Label: FieldLabel,
  Description: FieldDescription,
  Error: FieldError,
};
export const Badge = ({
  color,
  variant,
  ...props
}: Omit<React.ComponentProps<typeof ShadcnBadge>, 'variant'> & {
  color?: string;
  variant?: string;
}) => (
  <ShadcnBadge
    {...props}
    variant={
      color === 'red'
        ? 'destructive'
        : variant === 'outline'
          ? 'outline'
          : 'secondary'
    }
  />
);

const EMPTY = '__recruiting_empty__';
type SelectOption = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};
/** Uses a grouped Radix list rather than native browser select controls. */
export const Select = ({
  value,
  onChange,
  options,
  disabled,
  dropdownId,
  className,
  label,
  fullWidth,
  'aria-label': ariaLabel,
}: {
  value?: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  dropdownId?: string;
  className?: string;
  label?: React.ReactNode;
  fullWidth?: boolean;
  'aria-label'?: string;
}) => {
  const control = (
    <SelectRoot
      value={value || EMPTY}
      onValueChange={(next) => onChange(next === EMPTY ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={dropdownId}
        aria-label={
          ariaLabel ?? (typeof label === 'string' ? label : undefined)
        }
        className={cn(fullWidth ? 'w-full' : 'min-w-32', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="recruiting-shadcn">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              key={option.value || EMPTY}
              value={option.value || EMPTY}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </SelectRoot>
  );
  return label ? (
    <ShadcnField>
      <FieldLabel htmlFor={dropdownId}>{label}</FieldLabel>
      {control}
    </ShadcnField>
  ) : (
    control
  );
};
/** Bridges simple option lists while preserving their current value callbacks. */
export const NativeSelectAdapter = ({
  value,
  onChange,
  children,
  style,
  className,
  disabled,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) => {
  const options = React.Children.toArray(children)
    .filter(React.isValidElement)
    .map((child) => {
      const p = (
        child as React.ReactElement<{
          value: string;
          children: React.ReactNode;
          disabled?: boolean;
        }>
      ).props;
      return {
        value: String(p.value ?? ''),
        label: p.children,
        disabled: p.disabled,
      };
    });
  return (
    <span style={style} className={className}>
      <Select
        value={String(value ?? '')}
        disabled={disabled}
        options={options}
        onChange={(next) =>
          onChange?.({
            target: { value: next },
            currentTarget: { value: next },
          } as React.ChangeEvent<HTMLSelectElement>)
        }
        dropdownId={props.id}
        aria-label={props['aria-label']}
      />
    </span>
  );
};
/** Keeps the old modal composition while shadcn owns focus trapping and overlays. */
const Popup = ({
  size,
  children,
  className,
  ...props
}: React.ComponentProps<typeof DialogContent> & { size?: string }) => (
  <DialogContent
    {...props}
    showCloseButton={false}
    className={cn(
      'recruiting-shadcn flex max-h-[85dvh] flex-col sm:max-w-4xl',
      className,
    )}
  >
    {children}
  </DialogContent>
);
export const Dialog = {
  Root: DialogRoot,
  Portal: React.Fragment,
  Backdrop: () => null,
  Viewport: React.Fragment,
  Popup,
  Header: DialogHeader,
  Title: DialogTitle,
  Footer: DialogFooter,
  Body: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} className="min-h-0 overflow-y-auto">
      {children}
    </div>
  ),
  Close: DialogClose,
  Trigger: DialogTrigger,
};

/** Converts native progress totals to the shadcn percentage contract. */
export const Progress = ({
  value = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof ShadcnProgress> & { max?: number }) => (
  <ShadcnProgress {...props} value={(Number(value) / Math.max(1, max)) * 100} />
);

/** Uses semantic status variants instead of browser-native select backgrounds. */
export const StatusBadge = ({
  'data-tone': tone,
  ...props
}: React.ComponentProps<typeof ShadcnBadge> & { 'data-tone'?: string }) => (
  <ShadcnBadge
    {...props}
    variant={
      tone === 'green'
        ? 'success'
        : tone === 'yellow'
          ? 'warning'
          : tone === 'blue'
            ? 'info'
            : tone === 'red'
              ? 'destructive'
              : 'secondary'
    }
  />
);
export const ErrorAlert = ({
  children,
  ...props
}: React.ComponentProps<typeof Alert>) => (
  <Alert {...props} variant="destructive">
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);

/** Inactive tabs do not mount data-heavy workbench screens. */
export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Tab: TabsTrigger,
  Indicator: () => null,
  Panel: ({
    keepMounted,
    className,
    ...props
  }: React.ComponentProps<typeof TabsContent> & { keepMounted?: boolean }) => (
    <TabsContent
      {...props}
      className={cn('min-h-0 flex-1 overflow-auto', className)}
    />
  ),
};
