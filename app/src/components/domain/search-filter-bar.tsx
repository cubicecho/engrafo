import { useId } from 'react';
import type { DocumentKind } from '@/__generated__/graphql';
import { Combobox } from '@/components/combobox';
import { DateRangePicker } from '@/components/date-picker';
import { Button } from '@/components/ui/button';
import { SwitchField } from '@/components/ui/switch-field';
import { fromCalendarDay, toCalendarDay } from '@/lib/calendar-day';
import { type FolderRow, folderOptions, TOP_LEVEL } from '@/lib/folder-tree';
import { KIND_OPTIONS, NO_FILTERS, type SearchFilters } from '@/lib/search-filters';
import { menuValueOf, storedValueOf, withEmptyOption } from '@/lib/select-options';

interface SearchFilterBarProps {
  /** Every folder of the caller's, for the folder picker. */
  folders: readonly FolderRow[];
  value: SearchFilters;
  onValueChange: (filters: SearchFilters) => void;
}

/**
 * What a search or the list is narrowed to: a folder (with everything inside it), a kind of document, the
 * date on the document, and receipts only. One wrapping row above the results, as cubeui's filter
 * bar is, each control given a width so none takes the line.
 */
export function SearchFilterBar({ folders, value, onValueChange }: SearchFilterBarProps) {
  const receiptsId = useId();
  const set = (patch: Partial<SearchFilters>) => onValueChange({ ...value, ...patch });
  const isNarrowed =
    value.folderId !== null || value.kind !== null || value.from !== null || value.to !== null || value.receiptsOnly;
  const from = fromCalendarDay(value.from);
  const to = fromCalendarDay(value.to);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Combobox
        aria-label="Folder"
        className="w-48"
        options={withEmptyOption(
          folderOptions(folders).filter((option) => 'value' in option && option.value !== TOP_LEVEL),
          'Any folder',
        )}
        value={menuValueOf(value.folderId)}
        onValueChange={(folderId) => set({ folderId: storedValueOf(folderId) })}
        searchable
        searchPlaceholder="Find a folder"
      />
      <Combobox
        aria-label="Kind"
        className="w-36"
        options={withEmptyOption([...KIND_OPTIONS], 'Any kind')}
        value={menuValueOf(value.kind)}
        onValueChange={(kind) => set({ kind: (storedValueOf(kind) as DocumentKind | null) ?? null })}
      />
      <DateRangePicker
        aria-label="Dated"
        className="w-64"
        placeholder="Any date"
        value={from ? { from, to: to ?? undefined } : null}
        onValueChange={(range) =>
          set({
            from: range?.from ? toCalendarDay(range.from) : null,
            to: range?.to ? toCalendarDay(range.to) : null,
          })
        }
      />
      <SwitchField
        id={receiptsId}
        label="Receipts only"
        checked={value.receiptsOnly}
        onCheckedChange={(receiptsOnly) => set({ receiptsOnly })}
      />
      {isNarrowed && (
        <Button size="sm" variant="ghost" content="Clear filters" onClick={() => onValueChange({ ...NO_FILTERS })} />
      )}
    </div>
  );
}
