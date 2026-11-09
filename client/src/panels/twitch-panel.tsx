import { useLayoutEffect, useRef } from "preact/hooks";
import type { CacheEntry, TwitchStream } from "@shared/types";

interface Props {
    entry: CacheEntry<TwitchStream[]>;
}

const uptime = (startedAt: string): string => {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 60_000));
    return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/**
 * Whether Twitch will agree to render inside this page at all.
 *
 * Twitch requires a `parent` matching the embedding host and **rejects raw IP
 * addresses**; the docs also state that embedding domains must use SSL.
 * Production is `http://localhost:3000`, which passes both — localhost is a
 * browser secure context. The LAN dev rig is `http://192.168.1.225:5173`,
 * which fails both at once.
 *
 * So this is checked rather than assumed: on a host Twitch will refuse, the
 * panel falls back to the thumbnail card instead of showing a dead grey box
 * across the room where nobody can read the error inside it. An IP has no
 * letters in it, which is the whole test.
 */
const canEmbed = (host: string): boolean => host === "localhost" || /[a-z]/i.test(host);

/** 16:9. Every 100px here costs the news feed roughly two headlines. */
const EMBED_W = 400;
const EMBED_H = 225;

/**
 * Start muted?
 *
 * **False on purpose**, and it is not the obvious choice. Muted is the only
 * form of autoplay browsers permit unconditionally, so `true` maximises the
 * chance of the picture starting by itself — but it also means that when
 * autoplay *is* refused, starting the stream takes a keypress to play and a
 * second one to unmute.
 *
 * At `false`: if Chromium's autoplay policy is permissive the stream simply
 * starts with sound; if it is not, the single space press that starts it also
 * brings the sound with it. One key either way, never two.
 */
const MUTED = false;

/**
 * The live player.
 *
 * A plain iframe, deliberately, after a detour through the embed JS API. That
 * API offers `play()` and `setMuted()`, which looked like the answer to
 * autoplay — but **unmuting a muted autoplaying video without user activation
 * makes the browser pause it**, so calling `setMuted(false)` on READY produced
 * exactly the big play button over a blurred poster it was meant to prevent.
 * The JS API also builds its own iframe, which meant losing explicit control
 * of `allow="autoplay"` — the attribute that delegates the permission to a
 * cross-origin frame in the first place.
 *
 * So: our iframe, our `allow`, and the autoplay question left to the browser,
 * where it actually lives. `--autoplay-policy=no-user-gesture-required` in the
 * kiosk flags is what decides it; check `chrome://version` if the picture does
 * not start on its own.
 *
 * The player is **focused on mount** regardless. Whether or not autoplay is
 * permitted, the keyboard is already in the player, so starting it is one
 * space press rather than tab-then-space.
 */
function Player({ stream }: { stream: TwitchStream }) {
    const frame = useRef<HTMLIFrameElement>(null);
    const host = location.hostname;
    const src =
        `https://player.twitch.tv/?channel=${encodeURIComponent(stream.userLogin)}` +
        `&parent=${encodeURIComponent(host)}&autoplay=true&muted=${String(MUTED)}`;

    useLayoutEffect(() => {
        // Focus moves *into* the frame, so the keys go to Twitch's own handler
        // — which is what makes space work. Cross-origin is no obstacle to
        // this; reading the frame would be, but we are only handing it focus.
        frame.current?.focus();
        // Re-run when the streamer changes: a different login is a different
        // iframe, and the new one needs the keyboard too.
    }, [stream.userLogin]);

    return (
        <div class="twitch__player" style={{ width: EMBED_W, height: EMBED_H }}>
            <iframe
                ref={frame}
                class="twitch__frame"
                src={src}
                width={EMBED_W}
                height={EMBED_H}
                allow="autoplay; fullscreen"
                allowFullScreen
                title={`${stream.userName} live`}
                scrolling="no"
                frameBorder={0}
            />
            {/* An iframe swallows its own clicks, so the parent page cannot see
                them. This transparent layer sits above the player purely to
                catch one. It is out of the tab order: it sits on top of the
                thing we just focused, and must never take the keyboard back
                from it. */}
            <button
                class="twitch__expand"
                type="button"
                tabIndex={-1}
                aria-label={`Expand ${stream.userName}`}
                onClick={() => void frame.current?.requestFullscreen?.()}
            />
        </div>
    );
}

/**
 * Offline streamers are absent from the Helix response, so an empty array is
 * the offline signal. When nobody is live the panel renders nothing at all and
 * gives its height back to the news feed above it.
 *
 * Only the first live stream gets a player. Two autoplaying 1080p streams is
 * not a reasonable ask of a Pentium Silver, and two moving images in the corner
 * of a room is not a reasonable ask of a person.
 */
export function TwitchPanel({ entry }: Props) {
    const live = entry.data ?? [];
    if (live.length === 0) {
        return null;
    }

    const embed = canEmbed(location.hostname);
    const [first, ...rest] = live;

    return (
        <section class="panel">
            <header class="panel__head">
                <span class="panel__title">Live</span>
            </header>
            <div class="panel__body twitch">
                <div class="twitch__stream" key={first!.userLogin}>
                    {embed ? (
                        <Player stream={first!} />
                    ) : (
                        <img class="twitch__thumb" src={first!.thumbnailUrl} alt="" />
                    )}
                    <div>
                        <div class="twitch__name">
                            <i class="twitch__dot" />
                            {first!.userName}
                        </div>
                        <div class="twitch__title">{first!.title}</div>
                        <div class="twitch__meta">
                            {first!.gameName || "Streaming"} · {first!.viewerCount.toLocaleString()}{" "}
                            · {uptime(first!.startedAt)}
                        </div>
                    </div>
                </div>

                {/* Anyone else live is a one-line mention, not a second player. */}
                {rest.slice(0, 2).map((s) => (
                    <div class="twitch__also" key={s.userLogin}>
                        <i class="twitch__dot" />
                        <span class="twitch__name">{s.userName}</span>
                        <span class="twitch__meta">
                            {s.gameName || "Streaming"} · {s.viewerCount.toLocaleString()}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}
