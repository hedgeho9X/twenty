/** Offers meaningful date presets and a deliberate calendar range instead of empty date inputs. */
import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { type DateRange } from 'react-day-picker';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

/** Date strings represent Shanghai calendar days at the API boundary. */
export const DateRangeFilter = ({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) => {
  const [preset, setPreset] = useState(from || to ? 'custom' : 'all');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(
    from && to
      ? { from: new Date(`${from}T12:00:00`), to: new Date(`${to}T12:00:00`) }
      : undefined,
  );
  const choose = (value: string) => {
    setPreset(value);
    if (value === 'custom') {
      setOpen(true);
      return;
    }
    if (value === 'all') {
      onChange('', '');
      return;
    }
    const now = new Date();
    onChange(
      format(
        subDays(now, value === 'today' ? 0 : value === 'week' ? 6 : 29),
        'yyyy-MM-dd',
      ),
      format(now, 'yyyy-MM-dd'),
    );
  };
  return (
    <div className="flex items-center gap-2">
      <Select value={preset} onValueChange={choose}>
        <SelectTrigger className="w-36" aria-label="时间范围">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">全部时间</SelectItem>
            <SelectItem value="today">今天</SelectItem>
            <SelectItem value="week">近 7 天</SelectItem>
            <SelectItem value="month">近 30 天</SelectItem>
            <SelectItem value="custom">自定义范围</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {preset === 'custom' && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline">
              {from && to ? `${from} 至 ${to}` : '选择日期范围'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
            <Calendar
              mode="range"
              locale={zhCN}
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
            />
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(undefined);
                  setPreset('all');
                  onChange('', '');
                  setOpen(false);
                }}
              >
                清除
              </Button>
              <Button
                disabled={!draft?.from || !draft?.to}
                onClick={() => {
                  if (draft?.from && draft.to)
                    onChange(
                      format(draft.from, 'yyyy-MM-dd'),
                      format(draft.to, 'yyyy-MM-dd'),
                    );
                  setOpen(false);
                }}
              >
                应用范围
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};
