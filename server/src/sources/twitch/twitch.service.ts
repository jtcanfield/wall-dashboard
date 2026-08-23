import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { CacheService } from "../../cache/cache.service";
import { getJson } from "../../cache/http";
import { TwitchStream } from "../../shared";
import { stagger } from "../stagger";

interface TokenResponse {
    access_token: string;
}

interface StreamsResponse {
    data?: {
        user_login: string;
        user_name: string;
        title: string;
        game_name: string;
        viewer_count: number;
        started_at: string;
        thumbnail_url: string;
    }[];
}

const THUMB = { width: 440, height: 248 };

@Injectable()
export class TwitchService implements OnModuleInit {
    private readonly log = new Logger(TwitchService.name);
    private token: string | null = null;

    constructor(
        private readonly cache: CacheService,
        private readonly config: ConfigService,
    ) {}

    onModuleInit(): void {
        if (this.logins().length === 0) {
            this.log.warn("TWITCH_LOGINS is empty — Twitch polling disabled");
            return;
        }
        stagger("twitch", () => this.refresh());
    }

    @Interval("twitch", 90_000)
    async refresh(): Promise<void> {
        if (this.logins().length === 0) {
            return;
        }
        await this.cache.refresh("twitch", () => this.fetchStreams());
    }

    private logins(): string[] {
        return (this.config.get<string>("TWITCH_LOGINS") ?? "")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 100); // Helix caps at 100 user_login params per call
    }

    /**
     * Offline streamers are simply absent from the response array — that's the
     * offline signal, not a status field.
     */
    private async fetchStreams(): Promise<TwitchStream[]> {
        const run = async (token: string) => {
            const url = new URL("https://api.twitch.tv/helix/streams");
            for (const login of this.logins()) {
                url.searchParams.append("user_login", login);
            }
            return getJson<StreamsResponse>(url.toString(), {
                headers: {
                    "Client-ID": this.clientId(),
                    Authorization: `Bearer ${token}`,
                },
            });
        };

        let res: StreamsResponse;
        try {
            res = await run(await this.accessToken());
        } catch (err) {
            // App tokens last ~60 days. Catching the 401 is simpler and more robust
            // than tracking expiry, which drifts across restarts anyway.
            if (!String(err).includes("HTTP 401")) {
                throw err;
            }
            this.log.log("Twitch token rejected, re-authenticating");
            this.token = null;
            res = await run(await this.accessToken());
        }

        return (res.data ?? []).map((s) => ({
            userLogin: s.user_login,
            userName: s.user_name,
            title: s.title,
            gameName: s.game_name,
            viewerCount: s.viewer_count,
            startedAt: s.started_at,
            thumbnailUrl: s.thumbnail_url
                .replace("{width}", String(THUMB.width))
                .replace("{height}", String(THUMB.height)),
        }));
    }

    private clientId(): string {
        const id = this.config.get<string>("TWITCH_CLIENT_ID");
        if (!id) {
            throw new Error("TWITCH_CLIENT_ID is not set");
        }
        return id;
    }

    /** client_credentials: read-only public stream state needs no user login. */
    private async accessToken(): Promise<string> {
        if (this.token) {
            return this.token;
        }
        const secret = this.config.get<string>("TWITCH_CLIENT_SECRET");
        if (!secret) {
            throw new Error("TWITCH_CLIENT_SECRET is not set");
        }

        const body = new URLSearchParams({
            client_id: this.clientId(),
            client_secret: secret,
            grant_type: "client_credentials",
        });
        const res = await getJson<TokenResponse>("https://id.twitch.tv/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
        });
        this.token = res.access_token;
        return this.token;
    }
}
