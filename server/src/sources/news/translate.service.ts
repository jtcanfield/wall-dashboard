import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { HttpError, getJson } from "../../cache/http";
import { dataPath } from "../../paths";

interface MyMemoryResponse {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    responseDetails?: string;
}

/** What survives a restart. */
interface TranslationStore {
    /** YYYY-MM-DD the spend below belongs to. */
    day: string;
    spentChars: number;
    /** Source text -> translation. */
    entries: Record<string, string>;
}

const STORE_PATH = dataPath("translations.json");

/**
 * The daily character allowance. Anonymous requests get 5k/day; passing a
 * contact address in `de` raises it to 50k.
 */
const DAILY_CHAR_BUDGET_ANON = 4_500;
const DAILY_CHAR_BUDGET_WITH_EMAIL = 45_000;

/** Ceiling on new translations per refresh, to spread spend across the day. */
const MAX_PER_REFRESH = 8;

/**
 * Minimum gap between outbound requests.
 *
 * MyMemory rate-limits per second as well as per day, and the previous version
 * fired a whole refresh back to back with no gap at all. Two Russian feeds at
 * five headlines each is a ten-request burst, which is what was earning 429s
 * long before the daily budget was anywhere near spent.
 */
const MIN_REQUEST_GAP_MS = 1_500;

/**
 * How long to stop asking after a 429 with no better information.
 *
 * A rate limiter answers a burst of retries with more 429s, so the only useful
 * response is to stop. New headlines keep their Cyrillic for this long and it
 * then tries again; nothing already cached is affected.
 */
const RATE_LIMIT_COOLDOWN_MS = 20 * 60_000;

/**
 * When the daily allowance is gone, MyMemory says exactly when it comes back:
 *
 *     MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY.
 *     NEXT AVAILABLE IN  04 HOURS 12 MINUTES 12 SECONDS
 *
 * Worth parsing. The alternative is either retrying every 20 minutes for four
 * hours to be told the same thing, or waiting for the internal budget counter
 * to roll at UTC midnight — which is not when MyMemory actually resets, so the
 * two drift apart and the panel stays untranslated hours longer than it needs.
 */
const QUOTA_RESET = /NEXT AVAILABLE IN\s+(\d+)\s*HOURS?\s+(\d+)\s*MINUTES?\s+(\d+)\s*SECONDS?/i;

function quotaResetMs(details: string): number | null {
    const m = QUOTA_RESET.exec(details);
    if (!m) {
        return null;
    }
    return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1_000;
}

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/**
 * Russian -> English headline translation via MyMemory (free, no API key).
 *
 * Deliberately fail-open: any error, budget exhaustion, rate limit or
 * malformed response leaves the original text in place. A Cyrillic headline on
 * the wall is worse than an English one but far better than a blank panel —
 * the same principle as the cache contract.
 *
 * **The cache is on disk, not just in memory.** It used to be a bare Map, so
 * every restart re-translated every visible Russian headline from scratch —
 * which in a watch-restart dev loop meant paying the full cost several times
 * an hour and collecting 429s that had nothing to do with the daily budget.
 * "Cached forever" has to outlive the process to mean anything.
 *
 * Lingva/LibreTranslate were tried first and every public instance returned
 * 500 or sat behind a Cloudflare challenge.
 */
@Injectable()
export class TranslateService implements OnModuleInit {
    private readonly log = new Logger(TranslateService.name);
    private readonly cache = new Map<string, string>();
    private spentChars = 0;
    private budgetDay = "";
    /** Epoch ms before which no request may be made. Set by a 429. */
    private cooldownUntil = 0;
    private lastRequestAt = 0;
    private saveTimer: NodeJS.Timeout | null = null;
    private dirty = false;

    constructor(private readonly config: ConfigService) {}

    async onModuleInit(): Promise<void> {
        await this.restore();
    }

    private get contactEmail(): string | undefined {
        // Opt-in only. Setting this sends the address to MyMemory with every
        // request, which is what raises the quota tenfold.
        return this.config.get<string>("MYMEMORY_EMAIL") || undefined;
    }

    private get dailyBudget(): number {
        return this.contactEmail ? DAILY_CHAR_BUDGET_WITH_EMAIL : DAILY_CHAR_BUDGET_ANON;
    }

    private rollDay(): void {
        const today = new Date().toISOString().slice(0, 10);
        if (today !== this.budgetDay) {
            this.budgetDay = today;
            this.spentChars = 0;
            this.dirty = true;
        }
    }

    private async restore(): Promise<void> {
        try {
            const raw = await fs.readFile(STORE_PATH, "utf8");
            const store = JSON.parse(raw) as Partial<TranslationStore>;
            for (const [source, translated] of Object.entries(store.entries ?? {})) {
                this.cache.set(source, translated);
            }
            // The spend only carries forward if it belongs to today; rollDay
            // clears it otherwise.
            this.budgetDay = store.day ?? "";
            this.spentChars = store.spentChars ?? 0;
            this.rollDay();
            this.log.log(
                `Restored ${this.cache.size} translations (${this.spentChars} chars spent today)`,
            );
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                this.log.warn(`Could not restore translation cache — ${String(err)}`);
            }
        }
    }

    /** Debounced: one refresh translates several headlines and should cost one write. */
    private scheduleSave(): void {
        this.dirty = true;
        if (this.saveTimer) {
            return;
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, 2_000);
        // Never hold the process open just to flush a cache.
        this.saveTimer.unref?.();
    }

    private async save(): Promise<void> {
        if (!this.dirty) {
            return;
        }
        this.dirty = false;
        const store: TranslationStore = {
            day: this.budgetDay,
            spentChars: this.spentChars,
            entries: Object.fromEntries(this.cache),
        };
        try {
            await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
            await fs.writeFile(STORE_PATH, JSON.stringify(store), "utf8");
        } catch (err) {
            this.log.warn(`Could not persist translation cache — ${String(err)}`);
        }
    }

    /** Translate many strings, preserving order. Untranslatable entries come back as-is. */
    async translateAll(texts: string[], from: string, to = "en"): Promise<string[]> {
        this.rollDay();
        let budgetedThisRun = 0;

        const out: string[] = [];
        for (const text of texts) {
            // Cache first, always. A rate limit or an exhausted budget must
            // never cost a headline that has already been paid for.
            const cached = this.cache.get(text);
            if (cached !== undefined) {
                out.push(cached);
                continue;
            }
            if (
                Date.now() < this.cooldownUntil ||
                budgetedThisRun >= MAX_PER_REFRESH ||
                this.spentChars + text.length > this.dailyBudget
            ) {
                out.push(text);
                continue;
            }

            budgetedThisRun++;
            out.push(await this.translateOne(text, from, to));
        }
        return out;
    }

    private async throttle(): Promise<void> {
        const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
        this.lastRequestAt = Date.now();
    }

    private startCooldown(reason: string): void {
        this.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        this.log.warn(
            `${reason} — pausing translation for ${RATE_LIMIT_COOLDOWN_MS / 60_000} minutes. ` +
                `Cached headlines are unaffected; new ones stay in Russian until then.`,
        );
    }

    private async translateOne(text: string, from: string, to: string): Promise<string> {
        const url = new URL("https://api.mymemory.translated.net/get");
        url.searchParams.set("q", text);
        url.searchParams.set("langpair", `${from}|${to}`);
        const email = this.contactEmail;
        if (email) {
            url.searchParams.set("de", email);
        }

        try {
            await this.throttle();
            const res = await getJson<MyMemoryResponse>(url.toString(), {}, 12_000);
            const translated = res.responseData?.translatedText?.trim();

            // Quota problems are reported in the body, with a 200 status.
            if (!translated || /MYMEMORY WARNING|QUOTA|LIMIT/i.test(res.responseDetails ?? "")) {
                const details = res.responseDetails ?? "empty response";
                const resetIn = quotaResetMs(details);
                if (resetIn !== null) {
                    this.cooldownUntil = Date.now() + resetIn;
                    this.log.warn(
                        `Daily allowance spent — resuming in ${Math.round(resetIn / 60_000)} minutes`,
                    );
                } else {
                    this.spentChars = this.dailyBudget; // stop trying until tomorrow
                    this.scheduleSave();
                    this.log.warn(`Translation unavailable — ${details}`);
                }
                return text;
            }

            this.spentChars += text.length;
            this.cache.set(text, translated);
            this.scheduleSave();
            return translated;
        } catch (err) {
            if (err instanceof HttpError && err.status === 429) {
                // Retrying into a rate limiter just earns more 429s.
                this.startCooldown("MyMemory returned 429");
            } else {
                this.log.warn(`Translation failed, keeping original — ${String(err)}`);
            }
            return text;
        }
    }
}
