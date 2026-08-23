/**
 * Chart colours are defined once in styles.css as custom properties and read
 * back here, so the palette has a single source of truth and canvas drawing
 * can't drift from the CSS.
 */
export const cssVar = (name: string): string =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

/** `#58a6ff` + 0.3 -> `rgba(88, 166, 255, 0.3)`. Canvas has no colour-mix. */
export const alpha = (hex: string, a: number): string => {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/**
 * Exchange rates span three orders of magnitude across the pairs on screen
 * (EUR ~0.86, CNY ~6.7, RUB ~84), so precision has to follow the value.
 */
export const formatRate = (rate: number): string =>
    rate >= 10 ? rate.toFixed(2) : rate >= 1 ? rate.toFixed(3) : rate.toFixed(4);
