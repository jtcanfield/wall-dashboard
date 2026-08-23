import { useDashboard } from "./use-dashboard";
import { useNow } from "./use-now";
import { ReminderBar } from "./panels/reminder-bar";
import { WeatherPanel } from "./panels/weather-panel";
import { LuftenPanel } from "./panels/luften-panel";
import { FxPanel } from "./panels/fx-panel";
import { NewsPanel } from "./panels/news-panel";
import { TwitchPanel } from "./panels/twitch-panel";

export function App() {
    const { state, connected } = useDashboard();
    const now = useNow();

    return (
        <div class="dashboard">
            <ReminderBar reminders={state.reminders} now={now} />

            <div class="dashboard__body">
                <div class="column column--left">
                    <WeatherPanel entry={state.weather} luften={state.luften} />
                    <LuftenPanel luften={state.luften} />
                </div>

                <div class="column column--right">
                    <FxPanel entry={state.fx} />
                    <NewsPanel entry={state.news} />
                    <TwitchPanel entry={state.twitch} />
                </div>
            </div>

            {/* EventSource reconnects on its own; this only says it hasn't yet. */}
            {!connected && <span class="offline" title="Disconnected" />}
        </div>
    );
}
