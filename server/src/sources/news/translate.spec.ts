import { HttpError } from "../../cache/http";
import { TranslateService } from "./translate.service";

jest.mock("../../cache/http", () => {
    const actual = jest.requireActual("../../cache/http");
    return { ...actual, getJson: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getJson } = require("../../cache/http") as { getJson: jest.Mock };

const reply = (text: string) => ({ responseData: { translatedText: text } });

/**
 * A service with the two things these cases must not touch stubbed out: the
 * on-disk store (tests should not write into server/data) and the inter-request
 * throttle (a real 1.5s gap per call would make the suite take a minute).
 *
 * Reaching through `private` deliberately — the alternative is widening the
 * public surface of the service purely so a test can hold it still.
 */
function service(): TranslateService {
    const svc = new TranslateService({ get: () => undefined } as never);
    const internals = svc as unknown as {
        save: () => Promise<void>;
        throttle: () => Promise<void>;
    };
    internals.save = () => Promise.resolve();
    internals.throttle = () => Promise.resolve();
    return svc;
}

describe("headline translation", () => {
    beforeEach(() => {
        getJson.mockReset();
    });

    it("translates once, then serves the same headline from cache", async () => {
        getJson.mockResolvedValue(reply("Explosion at the summit"));
        const svc = service();

        expect(await svc.translateAll(["Взрыв на саммите"], "ru")).toEqual([
            "Explosion at the summit",
        ]);
        expect(await svc.translateAll(["Взрыв на саммите"], "ru")).toEqual([
            "Explosion at the summit",
        ]);

        // The second call must not reach the network. This is the whole reason
        // the cache is persisted: a restart used to make every headline new
        // again and spend the budget re-buying what it already had.
        expect(getJson).toHaveBeenCalledTimes(1);
    });

    it("stops asking after a 429 rather than retrying into the limiter", async () => {
        getJson.mockRejectedValue(new HttpError(429, "https://api.mymemory.translated.net/get"));
        const svc = service();

        // Fail-open: every headline comes back untouched, none dropped.
        expect(await svc.translateAll(["один", "два", "три", "четыре"], "ru")).toEqual([
            "один",
            "два",
            "три",
            "четыре",
        ]);
        // One attempt; the cooldown suppresses the rest of the batch.
        expect(getJson).toHaveBeenCalledTimes(1);
    });

    it("keeps serving cached headlines while rate limited", async () => {
        getJson.mockResolvedValueOnce(reply("First"));
        const svc = service();
        await svc.translateAll(["первый"], "ru");

        getJson.mockRejectedValue(new HttpError(429, "url"));
        // The one already paid for survives the rate limit; only the new one waits.
        expect(await svc.translateAll(["первый", "второй"], "ru")).toEqual(["First", "второй"]);
    });

    it("treats an in-body quota warning as exhaustion despite the 200", async () => {
        getJson.mockResolvedValue({
            responseData: { translatedText: "" },
            responseDetails: "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS",
        });
        const svc = service();

        expect(await svc.translateAll(["один", "два"], "ru")).toEqual(["один", "два"]);
        expect(getJson).toHaveBeenCalledTimes(1);
    });

    it("waits exactly as long as MyMemory says the quota takes to reset", async () => {
        // The real message, verified against the live endpoint on 2026-08-24.
        getJson.mockResolvedValue({
            responseData: { translatedText: "" },
            responseDetails:
                "MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY. " +
                "NEXT AVAILABLE IN  04 HOURS 12 MINUTES 12 SECONDS VISIT " +
                "HTTPS://MYMEMORY.TRANSLATED.NET/DOC/USAGELIMITS.PHP TO TRANSLATE MORE",
        });
        const svc = service();
        const before = Date.now();

        expect(await svc.translateAll(["один", "два"], "ru")).toEqual(["один", "два"]);

        const until = (svc as unknown as { cooldownUntil: number }).cooldownUntil;
        const waitMinutes = (until - before) / 60_000;
        expect(waitMinutes).toBeGreaterThan(251);
        expect(waitMinutes).toBeLessThan(254);
        // And it does not keep asking in the meantime.
        expect(getJson).toHaveBeenCalledTimes(1);
    });

    it("keeps the original when the request fails for any other reason", async () => {
        getJson.mockRejectedValue(new Error("socket hang up"));
        const svc = service();

        expect(await svc.translateAll(["один"], "ru")).toEqual(["один"]);
    });
});
