import { getJson } from "../cache/http";
import { BreakingKind } from "../shared";

/**
 * NWS carries far more than weather. Of its 111 event types, these are the
 * IPAWS civil-emergency ones — the "red bar" category, and the reason this is
 * the alert source rather than a news API.
 *
 * `Administrative Message` is deliberately **not** here despite being in the
 * same family: it is routine NWS housekeeping and would put the bar up for
 * office notices. Everything else in this list means something is happening.
 */
const CIVIL_EVENTS = new Set([
    "Civil Danger Warning",
    "Shelter In Place Warning",
    "Law Enforcement Warning",
    "Evacuation Immediate",
    "Child Abduction Emergency",
    "Local Area Emergency",
    "Hazardous Materials Warning",
    "911 Telephone Outage",
    "Nuclear Power Plant Warning",
    "Radiological Hazard Warning",
    "Fire Warning",
    "Civil Emergency Message",
]);

/**
 * Severe weather rides the same poll, gated on severity rather than on a
 * hand-written list of event names. A list would need maintaining forever and
 * would silently miss whatever NWS adds next; `severity` is theirs to keep
 * current. Extreme/Severe catches a Tornado Warning and rejects the Special
 * Weather Statements that make up most of what the endpoint returns.
 */
const SEVERE = new Set(["Extreme", "Severe"]);

/** Future-dated and already-past alerts are not "breaking". */
const URGENT = new Set(["Immediate", "Expected"]);

interface AlertProperties {
    event?: string;
    headline?: string;
    areaDesc?: string;
    severity?: string;
    urgency?: string;
    /** "Actual" | "Exercise" | "System" | "Test" | "Draft" */
    status?: string;
    /** "Alert" | "Update" | "Cancel" | "Ack" | "Error" */
    messageType?: string;
    sent?: string;
    effective?: string;
    expires?: string;
    ends?: string;
}

interface AlertFeature {
    id?: string;
    properties?: AlertProperties;
}

export interface NwsAlert {
    id: string;
    kind: BreakingKind;
    headline: string;
    detail: string | null;
    since: string;
    until: string | null;
}

/**
 * Which bar, if any, an alert earns.
 *
 * The `status` check is load-bearing and easy to leave out: NWS really does
 * publish `Test` and `Exercise` alerts on the live endpoint, and an untested
 * red bar that fires for a drill is worse than no bar at all.
 */
export function classify(p: AlertProperties): BreakingKind | null {
    if (p.status !== "Actual") {
        return null;
    }
    if (p.messageType === "Cancel" || p.messageType === "Error") {
        return null;
    }
    if (!p.urgency || !URGENT.has(p.urgency)) {
        return null;
    }
    if (p.event && CIVIL_EVENTS.has(p.event)) {
        return "emergency";
    }
    if (p.severity && SEVERE.has(p.severity)) {
        return "weather";
    }
    return null;
}

export function toAlerts(features: AlertFeature[]): NwsAlert[] {
    const out: NwsAlert[] = [];
    for (const f of features) {
        const p = f.properties;
        if (!p) {
            continue;
        }
        const kind = classify(p);
        if (!kind || !p.event) {
            continue;
        }
        out.push({
            id: f.id ?? `${p.event}-${p.sent ?? ""}`,
            kind,
            // `headline` is the human sentence NWS writes; `event` is the type
            // name. Prefer the sentence, fall back to the type plus the area.
            headline: p.headline ?? `${p.event}${p.areaDesc ? ` — ${p.areaDesc}` : ""}`,
            detail: p.areaDesc ?? null,
            since: p.effective ?? p.sent ?? new Date().toISOString(),
            until: p.ends ?? p.expires ?? null,
        });
    }
    return out;
}

/**
 * Zone, not area. `?area=NC` returns Hatteras Island fishing advisories for a
 * dashboard in Raleigh; `?zone=NCZ041` is Wake County and the API echoes the
 * county name back in the response title, which makes a wrong zone obvious.
 */
export async function fetchNwsAlerts(zone: string): Promise<NwsAlert[]> {
    const url = `https://api.weather.gov/alerts/active?zone=${encodeURIComponent(zone)}`;
    const body = await getJson<{ features?: AlertFeature[] }>(url, {
        // NWS asks for a contactable User-Agent and rate-limits generic ones.
        headers: { "User-Agent": "wall-dashboard (github.com/jtcanfield)" },
    });
    return toAlerts(body.features ?? []);
}
