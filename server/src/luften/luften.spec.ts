import { dewPointF } from './dewpoint';
import { buildDays, findWindows } from './luften';
import { WeatherHour } from '../shared';

const hour = (time: string, tempF: number, dewPointF: number, precip = 0): WeatherHour => ({
  time,
  temperatureF: tempF,
  dewPointF,
  precipitationIn: precip,
  precipitationProbability: 0,
  relativeHumidity: 50,
});

describe('dewPointF', () => {
  it('matches the textbook value for the assumed indoor default', () => {
    // 70°F / 50% RH is roughly a 50°F dewpoint — the constant the whole
    // luften calculation is anchored on until a real sensor exists.
    expect(dewPointF(70, 50)).toBeCloseTo(50.5, 0);
  });

  it('equals the air temperature at saturation', () => {
    expect(dewPointF(60, 100)).toBeCloseTo(60, 1);
  });

  it('is monotonic in humidity', () => {
    expect(dewPointF(70, 30)).toBeLessThan(dewPointF(70, 70));
  });
});

describe('findWindows', () => {
  const indoorDp = 50; // so outdoor dewpoint must be <= 45

  it('interpolates the entry time rather than snapping to the hour', () => {
    // Temperature crosses the 67°F all-day floor two thirds of the way
    // through the 09:00 hour: 65 -> 68.
    const hourly = [
      hour('2026-04-10T09:00', 65, 40),
      hour('2026-04-10T10:00', 68, 40),
      hour('2026-04-10T11:00', 70, 40),
      hour('2026-04-10T12:00', 78, 40),
    ];
    const [w] = findWindows(hourly, 'all-day', indoorDp);
    expect(w?.start).toBe('2026-04-10T09:40');
  });

  it('interpolates the exit time when the band is left', () => {
    const hourly = [
      hour('2026-04-10T10:00', 70, 40),
      hour('2026-04-10T11:00', 74, 40),
      hour('2026-04-10T12:00', 78, 40), // crosses the 75°F ceiling at 11:15
    ];
    const [w] = findWindows(hourly, 'all-day', indoorDp);
    expect(w?.end).toBe('2026-04-10T11:15');
  });

  it('closes the window on the hour when it starts raining', () => {
    // Open-Meteo's hourly precipitation is a preceding-hour sum, so 0.2" at
    // 11:00 means it rained between 10:00 and 11:00. The window has to end at
    // 10:00 — interpolating an interval quantity would push it into the rain.
    const hourly = [
      hour('2026-04-10T09:00', 70, 40),
      hour('2026-04-10T10:00', 70, 40),
      hour('2026-04-10T11:00', 70, 40, 0.2),
    ];
    const [w] = findWindows(hourly, 'all-day', indoorDp);
    expect(w?.end).toBe('2026-04-10T10:00');
  });

  it('reopens once the rain has passed', () => {
    // Sums at 10:00 and 11:00 mean it rained from 09:00 to 11:00, so the dry
    // spell — and the window — begins at 11:00.
    const hourly = [
      hour('2026-04-10T09:00', 70, 40),
      hour('2026-04-10T10:00', 70, 40, 0.3),
      hour('2026-04-10T11:00', 70, 40, 0.3),
      hour('2026-04-10T12:00', 70, 40),
      hour('2026-04-10T13:00', 70, 40),
    ];
    const windows = findWindows(hourly, 'all-day', indoorDp);
    expect(windows.map((w) => [w.start, w.end])).toEqual([
      ['2026-04-10T11:00', '2026-04-10T13:00'],
    ]);
  });

  it('rejects humid outdoor air even when the temperature is perfect', () => {
    // 70°F and comfortable, but the dewpoint is above indoors: opening the
    // windows imports moisture. This is the case RH-based gating gets wrong.
    const hourly = [
      hour('2026-07-10T10:00', 70, 68),
      hour('2026-07-10T11:00', 72, 69),
    ];
    expect(findWindows(hourly, 'all-day', indoorDp)).toHaveLength(0);
  });

  it('still finds an air-exchange burst in dry cold air', () => {
    // Well below the all-day comfort band, but cold dry air is the best
    // drying agent available — Stoßlüften should be on.
    const hourly = [
      hour('2026-01-10T10:00', 45, 20),
      hour('2026-01-10T11:00', 46, 21),
      hour('2026-01-10T12:00', 45, 20),
    ];
    expect(findWindows(hourly, 'exchange', indoorDp)).toHaveLength(1);
    expect(findWindows(hourly, 'all-day', indoorDp)).toHaveLength(0);
  });
});

describe('buildDays', () => {
  it('reports an empty day rather than omitting it', () => {
    // A Raleigh summer day: nothing qualifies. The panel must be able to say
    // "no window today" explicitly, so the day still has to appear.
    const hourly = [
      hour('2026-07-10T10:00', 88, 74),
      hour('2026-07-10T11:00', 91, 75),
      hour('2026-07-11T10:00', 89, 74),
    ];
    const days = buildDays(hourly, 50);
    expect(days.map((d) => d.date)).toEqual(['2026-07-10', '2026-07-11']);
    expect(days.every((d) => d.windows.length === 0)).toBe(true);
  });
});
