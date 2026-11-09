import { wmoFromShortForecast } from "./wmo";

describe("NWS shortForecast to WMO code", () => {
    it("reads the plain cloud-cover phrases", () => {
        expect(wmoFromShortForecast("Sunny")).toBe(0);
        expect(wmoFromShortForecast("Mostly Sunny")).toBe(1);
        expect(wmoFromShortForecast("Partly Cloudy")).toBe(2);
        expect(wmoFromShortForecast("Mostly Cloudy")).toBe(3);
        expect(wmoFromShortForecast("Cloudy")).toBe(3);
    });

    it("does not let a bare 'cloudy' swallow the qualified forms", () => {
        // The ordering trap: "Partly Cloudy" contains "cloudy", so a generic
        // pattern placed above it reports overcast for a half-clear sky.
        expect(wmoFromShortForecast("Partly Cloudy")).not.toBe(3);
        expect(wmoFromShortForecast("Partly Sunny")).toBe(2);
    });

    it("prefers the severe phrase when a sentence carries two", () => {
        // NWS writes compound forecasts constantly, and the worse half is the
        // one worth an icon.
        expect(wmoFromShortForecast("Chance Showers And Thunderstorms")).toBe(95);
        expect(wmoFromShortForecast("Partly Sunny then Chance Thunderstorms")).toBe(95);
    });

    it("puts frozen and freezing ahead of plain rain, which they also say", () => {
        expect(wmoFromShortForecast("Freezing Rain")).toBe(66);
        expect(wmoFromShortForecast("Freezing Drizzle")).toBe(56);
        expect(wmoFromShortForecast("Rain And Snow")).toBe(73);
        expect(wmoFromShortForecast("Light Snow")).toBe(73);
        expect(wmoFromShortForecast("Heavy Snow")).toBe(75);
    });

    it("separates showers from steady rain", () => {
        expect(wmoFromShortForecast("Chance Rain Showers")).toBe(80);
        expect(wmoFromShortForecast("Rain")).toBe(63);
        expect(wmoFromShortForecast("Heavy Rain")).toBe(65);
    });

    it("treats obscuration as weather, not as cloud cover", () => {
        // "Patchy Fog" is not a cloud report, and the fog is the thing you
        // would want to know about.
        expect(wmoFromShortForecast("Patchy Fog")).toBe(45);
        expect(wmoFromShortForecast("Mostly Cloudy then Patchy Fog")).toBe(45);
    });

    it("returns null rather than guessing", () => {
        // A wrong icon is worse than no icon: it is confidently wrong at a
        // glance, from across a room.
        expect(wmoFromShortForecast("Breezy")).toBeNull();
        expect(wmoFromShortForecast("")).toBeNull();
        expect(wmoFromShortForecast(undefined)).toBeNull();
    });
});
