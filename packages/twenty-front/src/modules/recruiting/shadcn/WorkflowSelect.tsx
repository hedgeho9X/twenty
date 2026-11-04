/** Shares colored workflow choices between row controls and list filters. */
import { Badge } from './ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from './ui/select';
export const workflowOptions = {
  TODO: { label: '待处理', variant: 'info' },
  TO_CONTACT: { label: '待联系', variant: 'warning' },
  CONTACTED: { label: '已联系', variant: 'success' },
  DISMISSED: { label: '暂不推进', variant: 'secondary' },
} as const;
/** Selection changes workflow state only, never sends a message. */
export const WorkflowSelect = ({
  value,
  onChange,
  filter = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  filter?: boolean;
  disabled?: boolean;
}) => {
  const choice = workflowOptions[value as keyof typeof workflowOptions];
  return (
    <Select
      value={value || 'all'}
      onValueChange={(next) => onChange(next === 'all' ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={filter ? '筛选跟进状态' : '跟进状态'}
        className="w-36"
      >
        {choice ? (
          <Badge variant={choice.variant}>{choice.label}</Badge>
        ) : (
          <span>全部跟进状态</span>
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {filter && <SelectItem value="all">全部跟进状态</SelectItem>}
          {Object.entries(workflowOptions).map(([key, item]) => (
            <SelectItem key={key} value={key}>
              <Badge variant={item.variant}>{item.label}</Badge>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
