'use client';

/**
 * A segmented control: two to four panels, one shown. Tabs in the
 * accessibility tree, arrow keys to move, 44px tall so a thumb can hit it.
 *
 * The panels are the caller's: give each one `id={panelId(value)}`,
 * `role="tabpanel"`, `aria-labelledby={tabId(value)}` and `hidden` when it
 * is not the chosen one. Keeping every panel mounted is the point on the
 * compare screen, where edits on one side must survive a switch.
 */

import { useId, useRef } from 'react';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export function segmentedIds(base: string, value: string): { tab: string; panel: string } {
  return { tab: `${base}-tab-${value}`, panel: `${base}-panel-${value}` };
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  idBase,
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Shared with the panels so tab and panel point at each other. */
  idBase?: string;
}): React.ReactElement {
  const generated = useId();
  const base = idBase ?? generated;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (from: number, to: number): void => {
    const bounded = (to + options.length) % options.length;
    if (bounded === from) return;
    const option = options[bounded];
    if (option === undefined) return;
    onChange(option.value);
    buttons.current[bounded]?.focus();
  };

  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value;
        const ids = segmentedIds(base, option.value);
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttons.current[index] = el;
            }}
            type="button"
            role="tab"
            id={ids.tab}
            aria-selected={selected}
            aria-controls={ids.panel}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') move(index, index + 1);
              else if (event.key === 'ArrowLeft') move(index, index - 1);
              else if (event.key === 'Home') move(index, 0);
              else if (event.key === 'End') move(index, options.length - 1);
              else return;
              event.preventDefault();
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
