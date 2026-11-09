import { useLayoutEffect, useRef, useState } from "preact/hooks";
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
 * Player volume, 0–1, on top of whatever the system mixer is set to.
 *
 * A stream going live is not an event the room asked for, and it can happen at
 * any hour the display is on. Half volume is audible from the sofa without
 * being the loudest thing in the house. Set MUTED below to true to keep the
 * picture and drop the sound entirely.
 */
const VOLUME = 0.5;
const MUTED = false;

/* --------------------------------------------------------- the embed API */

interface TwitchPlayer {
    addEventListener(event: string, handler: () => void): void;
    setMuted(muted: boolean): void;
    setVolume(level: number): void;
    play(): void;
    destroy?(): void;
}

interface TwitchGlobal {
    Player: {
        new (target: HTMLElement | string, options: Record<string, unknown>): TwitchPlayer;
        READY: string;
    };
}

declare global {
    interface Window {
        Twitch?: TwitchGlobal;
    }
}

const EMBED_SCRIPT = "https://embed.twitch.tv/embed/v1.js";
let pending: Promise<TwitchGlobal> | null = null;

/**
 * Loads the embed script once and hands the same promise to every caller.
 *
 * A failure clears the cached promise rather than leaving a rejected one in
 * place: this display runs for sixteen hours, and a single bad minute of
 * network at boot must not mean no player until the next reboot.
 */
function loadEmbed(): Promise<TwitchGlobal> {
    if (window.Twitch?.Player) {
        return Promise.resolve(window.Twitch);
    }
    if (pending) {
        return pending;
    }
    pending = new Promise<TwitchGlobal>((resolve, reject) => {
        const el = document.createElement("script");
        el.src = EMBED_SCRIPT;
        el.async = true;
        el.onload = () => {
            if (window.Twitch?.Player) {
                resolve(window.Twitch);
            } else {
                reject(new Error("embed script loaded without Twitch.Player"));
            }
        };
        el.onerror = () => reject(new Error("could not load the Twitch embed script"));
        document.head.appendChild(el);
    });
    return pending.catch((err: unknown) => {
        pending = null;
        throw err;
    });
}

/**
 * The live player.
 *
 * Built on the embed **JS API** rather than a bare iframe, for one reason: the
 * iframe gives no way to start playback or to change the mute state, so it is
 * entirely at the mercy of the browser's autoplay heuristics — and when those
 * decline, the only recovery is a person walking over and pressing play.
 *
 * The sequence here is what makes autoplay reliable:
 *
 * 1. Construct **muted**. Muted autoplay is the one form browsers permit
 *    unconditionally; asking to start unmuted is how you get a paused player.
 * 2. On READY, unmute. Unmuting a stream that is *already playing* is not an
 *    autoplay action, so the policy does not apply to it.
 * 3. Call `play()` anyway, as the belt to that braces — harmless when it is
 *    already running, and the recovery if step 1 was still held back.
 */
function Player({ stream }: { stream: TwitchStream }) {
    const host = useRef<HTMLDivElement>(null);
    const [failed, setFailed] = useState(false);

    useLayoutEffect(() => {
        let player: TwitchPlayer | null = null;
        let cancelled = false;

        void loadEmbed()
            .then((Twitch) => {
                if (cancelled || !host.current) {
                    return;
                }
                player = new Twitch.Player(host.current, {
                    channel: stream.userLogin,
                    parent: [location.hostname],
                    width: EMBED_W,
                    height: EMBED_H,
                    autoplay: true,
                    muted: true,
                    // Nothing on this display should be seekable, and the
                    // controls would only ever be covered by the overlay below.
                    controls: false,
                });
                player.addEventListener(Twitch.Player.READY, () => {
                    if (cancelled) {
                        return;
                    }
                    player?.play();
                    if (!MUTED) {
                        player?.setMuted(false);
                        player?.setVolume(VOLUME);
                    }
                });
            })
            .catch(() => {
                if (!cancelled) {
                    setFailed(true);
                }
            });

        return () => {
            cancelled = true;
            player?.destroy?.();
        };
        // Keyed on the login: a different streamer going live has to replace
        // the player, not reconfigure the old one.
    }, [stream.userLogin]);

    if (failed) {
        return <img class="twitch__thumb" src={stream.thumbnailUrl} alt="" />;
    }

    return (
        <div class="twitch__player" style={{ width: EMBED_W, height: EMBED_H }}>
            <div ref={host} class="twitch__frame" />
            {/* An iframe swallows its own clicks, so the parent page cannot see
                them. This transparent layer sits above the player purely to
                catch one, and fullscreens the container rather than the frame
                Twitch builds inside it. */}
            <button
                class="twitch__expand"
                type="button"
                aria-label={`Expand ${stream.userName}`}
                onClick={() => void host.current?.parentElement?.requestFullscreen?.()}
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
