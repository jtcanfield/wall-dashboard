/**
 * Mapping NWS prose onto WMO 4677 codes.
 *
 * Open-Meteo reports a numeric code directly. NWS does not — it gives a
 * `shortForecast` string written for people ("Chance Rain Showers then Partly
 * Sunny"). The fallback is only live when Open-Meteo is down, but a panel that
 * silently loses its icon exactly when the primary source fails is a panel
 * that tells you least when something is already wrong.
 *
 * So this maps the phrases NWS actually uses, and returns **null** for
 * anything it does not recognise rather than guessing. A wrong icon is worse
 * than no icon: it is confidently wrong at a glance, from across a room.
 */

/**
 * Ordered: the first match wins, so the specific phrases have to precede the
 * general ones. "Thunderstorms" contains neither "rain" nor "showers", but
 * "Chance Rain Showers" contains both "rain" and "showers" — and
 * "Light Snow and Patchy Fog" contains both "snow" and "fog".
 */
const PHRASES: ReadonlyArray<readonly [RegExp, number]> = [
    // Severe first. These override anything else in the sentence.
    [/thunder|t-?storm/i, 95],

    // Frozen and freezing before plain rain, since they say "rain" too.
    [/freezing rain|ice storm|sleet/i, 66],
    [/freezing drizzle/i, 56],
    [/blizzard|heavy snow/i, 75],
    [/snow shower|flurries/i, 85],
    [/snow/i, 73],

    // Obscuration before cloud cover; "Patchy Fog" is not a cloud report.
    [/fog|haze|mist/i, 45],

    // Liquid, heaviest phrasing first.
    [/heavy rain/i, 65],
    [/rain shower|showers/i, 80],
    [/drizzle/i, 53],
    [/rain/i, 63],

    // Cloud cover last — the least specific thing NWS says — and qualified
    // before bare. "Partly Cloudy" contains "cloudy", so a generic /cloudy/
    // placed above it swallows every qualified variant and reports overcast
    // for a half-clear sky.
    [/partly cloudy|partly sunny/i, 2],
    [/mostly cloudy/i, 3],
    [/mostly sunny|mostly clear/i, 1],
    [/overcast|cloudy/i, 3],
    [/sunny|clear|fair/i, 0],
];

/**
 * `null` for anything unrecognised, and for an absent forecast. Callers render
 * no icon rather than a wrong one.
 */
export function wmoFromShortForecast(text: string | undefined): number | null {
    if (!text) {
        return null;
    }
    for (const [pattern, code] of PHRASES) {
        if (pattern.test(text)) {
            return code;
        }
    }
    return null;
}
