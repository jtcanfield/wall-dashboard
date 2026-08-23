import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getJson } from "../../cache/http";

interface MyMemoryResponse {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    responseDetails?: string;
}

/**
 * MyMemory's daily character allowance. Anonymous requests get 5k/day; passing
 * a contact address in `de` raises it to 50k. Headlines average ~60 chars and
 * every result is cached forever, so even the anonymous tier covers a normal
 * day of one Russian-language feed — the budget exists to make the failure
 * mode "stop translating" rather than "start getting 429s".
 */
const DAILY_CHAR_BUDGET_ANON = 4_500;
const DAILY_CHAR_BUDGET_WITH_EMAIL = 45_000;

/** Ceiling on new translations per refresh, to spread spend across the day. */
const MAX_PER_REFRESH = 12;

/**
 * Russian -> English headline translation via MyMemory (free, no API key).
 *
 * Deliberately fail-open: any error, budget exhaustion or malformed response
 * leaves the original text in place. A Cyrillic headline on the wall is a
 * worse outcome than an English one, but it is far better than a blank panel —
 * the same principle as the cache contract.
 *
 * Lingva/LibreTranslate were tried first and every public instance returned
 * 500 or sat behind a Cloudflare challenge.
 */
@Injectable()
export class TranslateService {
    private readonly log = new Logger(TranslateService.name);
    /** Source text -> translation. Unbounded is fine; headlines are tiny. */
    private readonly cache = new Map<string, string>();
    private spentChars = 0;
    private budgetDay = "";

    constructor(private readonly config: ConfigService) {}

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
        }
    }

    /** Translate many strings, preserving order. Untranslatable entries come back as-is. */
    async translateAll(texts: string[], from: string, to = "en"): Promise<string[]> {
        this.rollDay();
        let budgetedThisRun = 0;

        const out: string[] = [];
        for (const text of texts) {
            const cached = this.cache.get(text);
            if (cached !== undefined) {
                out.push(cached);
                continue;
            }
            if (
                budgetedThisRun >= MAX_PER_REFRESH ||
                this.spentChars + text.length > this.dailyBudget
            ) {
                out.push(text);
                continue;
            }

            budgetedThisRun++;
            const translated = await this.translateOne(text, from, to);
            out.push(translated);
        }
        return out;
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
            const res = await getJson<MyMemoryResponse>(url.toString(), {}, 12_000);
            const translated = res.responseData?.translatedText?.trim();

            // MyMemory reports quota problems in the body with a 200 status.
            if (!translated || /MYMEMORY WARNING|QUOTA|LIMIT/i.test(res.responseDetails ?? "")) {
                this.log.warn(
                    `Translation unavailable — ${res.responseDetails ?? "empty response"}`,
                );
                this.spentChars = this.dailyBudget; // stop trying until tomorrow
                return text;
            }

            this.spentChars += text.length;
            this.cache.set(text, translated);
            return translated;
        } catch (err) {
            this.log.warn(`Translation failed, keeping original — ${String(err)}`);
            return text;
        }
    }
}
