import { useDashboard } from "./use-dashboard";
import { useNow } from "./use-now";
import { TopBar } from "./panels/topbar";
import { WeatherPanel } from "./panels/weather-panel";
import { FxPanel } from "./panels/fx-panel";
import { NewsPanel } from "./panels/news-panel";
import { TwitchPanel } from "./panels/twitch-panel";

export function App() {
    const { state, connected } = useDashboard();
    const now = useNow();

    return (
        <div class="dashboard">
            {/* Reminders and luften share the top bar, rotating between them. */}
            <TopBar reminders={state.reminders} luften={state.luften} now={now} />

            <div class="dashboard__body">
                <div class="column column--left">
                    <WeatherPanel entry={state.weather} luften={state.luften} />
                    <FxPanel entry={state.fx} />
                </div>

                <div class="column column--right">
                    <NewsPanel entry={state.news} />
                    <TwitchPanel entry={state.twitch} />
                </div>
            </div>

            {/* EventSource reconnects on its own; this only says it hasn't yet. */}
            {!connected && <span class="offline" title="Disconnected" />}
        </div>
    );
}
