const A = 17.625;
const B = 243.04;

export const fToC = (f: number): number => ((f - 32) * 5) / 9;
export const cToF = (c: number): number => (c * 9) / 5 + 32;

/**
 * Magnus formula. Relative humidity is the wrong metric for deciding whether
 * to open a window — RH is relative to temperature, so 60°F air at 90% RH
 * holds less water than 75°F air at 60% RH. What actually dries the house is
 * outdoor dewpoint below indoor dewpoint, so everything upstream converts to
 * dewpoint first.
 */
export function dewPointC(tempC: number, relativeHumidity: number): number {
    const rh = Math.min(Math.max(relativeHumidity, 0.1), 100);
    const alpha = Math.log(rh / 100) + (A * tempC) / (B + tempC);
    return (B * alpha) / (A - alpha);
}

export function dewPointF(tempF: number, relativeHumidity: number): number {
    return cToF(dewPointC(fToC(tempF), relativeHumidity));
}
