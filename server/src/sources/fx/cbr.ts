import { DateTime } from 'luxon';
import { FxPoint } from '../../shared';
import { getText } from '../../cache/http';

/** Central Bank of Russia's currency code for USD. */
const CBR_USD = 'R01235';

/**
 * Fallback for the one pair the ECB cannot supply: the ECB suspended its
 * EUR/RUB reference rate on 1 March 2022, so any ECB-sourced feed has no RUB
 * data at all. CBR's free XML dynamic-rates feed covers it.
 *
 * The feed is windows-1251, but every field we read is ASCII, so decoding it
 * as UTF-8 only garbles the Cyrillic name we ignore.
 */
export async function fetchCbrRubPerUsd(from: DateTime, to: DateTime): Promise<FxPoint[]> {
  const fmt = (d: DateTime) => d.toFormat('dd/LL/yyyy');
  const url =
    `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${fmt(from)}` +
    `&date_req2=${fmt(to)}&VAL_NM_RQ=${CBR_USD}`;

  const xml = await getText(url);
  const records = xml.matchAll(
    /<Record\s+Date="(\d{2})\.(\d{2})\.(\d{4})"[^>]*>[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d,.]+)<\/Value>/g,
  );

  const points: FxPoint[] = [];
  for (const m of records) {
    const [, dd, mm, yyyy, nominal, value] = m;
    if (!dd || !mm || !yyyy || !nominal || !value) continue;
    // CBR writes decimals with a comma.
    const rate = Number(value.replace(',', '.')) / Number(nominal);
    if (Number.isFinite(rate)) points.push({ date: `${yyyy}-${mm}-${dd}`, rate });
  }

  if (points.length === 0) throw new Error('CBR returned no usable records');
  return points.sort((a, b) => a.date.localeCompare(b.date));
}
