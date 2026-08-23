import { DateTime } from "luxon";

interface Props {
    now: DateTime;
}

/**
 * The zones worth a glance from this room, west to east.
 *
 * IANA names, never fixed offsets — Berlin observes DST, Moscow and
 * Yekaterinburg have not since 2014, and hard-coding +1/+3/+5 would silently
 * drift twice a year.
 */
const ZONES = [
    { label: "BER", zone: "Europe/Berlin" },
    { label: "MSK", zone: "Europe/Moscow" },
    { label: "YEK", zone: "Asia/Yekaterinburg" },
] as const;

/**
 * A skinny row of digital clocks in the top bar.
 *
 * 24-hour, because these are read against a local 12-hour clock and an
 * unlabelled "3:40" beside it invites exactly the wrong subtraction. The day
 * marker matters more than it looks: all three zones run ahead of Eastern, so
 * for much of the evening here they are already on tomorrow.
 */
export function WorldClock({ now }: Props) {
    return (
        <span class="worldclock">
            {ZONES.map(({ label, zone }) => {
                const there = now.setZone(zone);
                // Compare calendar dates, not day-of-month: subtracting the day
                // numbers reports -30 when local is the 31st and there is the 1st.
                const here = now.toFormat("yyyy-LL-dd");
                const thereDate = there.toFormat("yyyy-LL-dd");
                const dayShift = thereDate === here ? 0 : thereDate > here ? 1 : -1;
                return (
                    <span class="worldclock__zone" key={zone}>
                        <span class="worldclock__label">{label}</span>
                        <span class="worldclock__time">
                            {there.toFormat("HH:mm")}
                            {dayShift !== 0 && (
                                <sup class="worldclock__day">{dayShift > 0 ? "+1" : "-1"}</sup>
                            )}
                        </span>
                    </span>
                );
            })}
        </span>
    );
}
