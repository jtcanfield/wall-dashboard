import { useLayoutEffect, useRef, useState } from "preact/hooks";

interface Props {
    text: string;
    /** Extra class on the viewport, so callers keep their own type scale. */
    class?: string;
}

/**
 * Scroll speed, px/second. Brisk — the top bar is a glance target and a long
 * reminder should get out of its own way, unlike the news feed's deliberate
 * 14px/s crawl.
 */
const PX_PER_SECOND = 90;

/**
 * Horizontal marquee for a single line of text that does not fit.
 *
 * Loops rather than ping-ponging: the track carries the text twice and
 * translates by exactly one copy's width, so the text always travels the same
 * direction and the wrap is seamless. A bouncing marquee reverses direction
 * mid-sentence, which is far harder to read than a loop.
 *
 * Because a seamless loop is otherwise indistinguishable from an endless
 * ribbon of text, each copy is headed by a **bar marker** so the start of the
 * message is identifiable. A bar rather than a dot deliberately: the top bar
 * already uses round dots to classify reminders and luften windows, and a
 * second dot with an unrelated meaning would read as one of those.
 *
 * Text that fits is left completely alone — no marker, no animation, no second
 * copy. The overwhelmingly common case costs nothing.
 *
 * The animation restarts on mount, and the top bar keys each face by id, so
 * every time a face flips in its message starts from the beginning rather than
 * halfway through.
 */
export function Marquee({ text, class: className }: Props) {
    const viewport = useRef<HTMLSpanElement>(null);
    const copy = useRef<HTMLSpanElement>(null);
    const echo = useRef<HTMLSpanElement>(null);
    const [distance, setDistance] = useState(0);
    const scrolling = distance > 0;

    useLayoutEffect(() => {
        const box = viewport.current;
        const first = copy.current;
        if (!box || !first) {
            return;
        }

        const measure = (): void => {
            // Once both copies exist, the only number that guarantees a seamless
            // wrap is how far apart they actually sit. Deriving it from the
            // first copy's own width instead means trusting that padding, flex
            // sizing and the box model all agree — and they did not: a copy
            // measuring 4383px sat 4191px from its twin, which is a 192px jump
            // once per cycle.
            const second = echo.current;
            if (second) {
                const apart = second.offsetLeft - first.offsetLeft;
                if (apart > 0) {
                    setDistance(apart);
                    return;
                }
            }
            setDistance(first.scrollWidth > box.clientWidth ? first.scrollWidth : 0);
        };
        measure();

        // The text is not the only thing that changes these widths: a late
        // webfont, or the clocks beside it reflowing, resize the viewport while
        // `text` stays put. A stale distance lands the loop in the wrong place
        // on every cycle rather than once.
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        observer.observe(first);
        return () => {
            observer.disconnect();
        };
        // `scrolling` is in the deps on purpose. The first pass measures a copy
        // that has no marker and no trailing gap yet, because those only exist
        // once we have decided to scroll — so that first number is short by
        // exactly their width. Re-running once the decision flips settles it in
        // a second pass. Deriving the dep from `distance > 0` rather than from
        // `distance` is what stops that being an infinite loop: the boolean
        // stops changing after the first correction.
    }, [text, scrolling]);

    return (
        <span
            class={`marquee${scrolling ? " marquee--scrolling" : ""}${
                className ? ` ${className}` : ""
            }`}
            ref={viewport}
        >
            <span
                class="marquee__track"
                style={{
                    "--marquee-distance": `${distance}px`,
                    animationDuration: scrolling ? `${distance / PX_PER_SECOND}s` : undefined,
                }}
            >
                <span class="marquee__copy" ref={copy}>
                    {scrolling && <i class="marquee__mark" />}
                    {text}
                </span>
                {/* The second copy is what makes the wrap seamless; it is
                    decoration, so it is hidden from assistive tech. */}
                {scrolling && (
                    <span class="marquee__copy" ref={echo} aria-hidden="true">
                        <i class="marquee__mark" />
                        {text}
                    </span>
                )}
            </span>
        </span>
    );
}
