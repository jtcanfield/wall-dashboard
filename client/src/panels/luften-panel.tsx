import { DateTime } from 'luxon';
import type { LuftenDay, LuftenState } from '@shared/types';
import { clockTime } from '../time';

interface Props {
  luften: LuftenState | null;
}

const label = (date: string): string => {
  const day = DateTime.fromISO(date);
  const today = DateTime.now().startOf('day');
  if (day.hasSame(today, 'day')) return 'Today';
  if (day.hasSame(today.plus({ days: 1 }), 'day')) return 'Tomorrow';
  return day.toFormat('cccc');
};

function Day({ day, isToday }: { day: LuftenDay; isToday: boolean }) {
  // All-day windows sit inside exchange windows, so show them first — they are
  // the stronger signal and the one the owner is actually picturing.
  const windows = [...day.windows].sort((a, b) =>
    a.kind === b.kind ? a.start.localeCompare(b.start) : a.kind === 'all-day' ? -1 : 1,
  );

  return (
    <div class="luften__day">
      <span class="luften__date">{label(day.date)}</span>
      {windows.length === 0 ? (
        // An explicit empty state: in a Raleigh summer the 67–75°F band is
        // empty most days, and a blank panel reads as a bug.
        <span class="luften__none">{isToday ? 'No window today' : 'None'}</span>
      ) : (
        windows.slice(0, 3).map((w) => (
          <span key={`${w.kind}-${w.start}`} class={`luften__window luften__window--${w.kind}`}>
            {clockTime(w.start)}–{clockTime(w.end)}
            {w.kind === 'exchange' && <small style="font-size: 13px">burst</small>}
          </span>
        ))
      )}
    </div>
  );
}

export function LuftenPanel({ luften }: Props) {
  return (
    <section class="panel">
      <header class="panel__head">
        <span class="panel__title">Luften</span>
        {luften && (
          <span class="luften__indoor">
            indoor {Math.round(luften.indoorDewPointF)}°F dewpoint ({luften.indoorSource})
          </span>
        )}
      </header>
      <div class="panel__body">
        {!luften ? (
          <span class="empty">Waiting for weather…</span>
        ) : (
          <div class="luften">
            <Day day={luften.today} isToday />
            {luften.lookahead.map((d) => (
              <Day key={d.date} day={d} isToday={false} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
