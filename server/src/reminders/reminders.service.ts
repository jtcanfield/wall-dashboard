import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DateTime } from "luxon";
import { promises as fs } from "node:fs";
import { configPath } from "../paths";
import { StateService } from "../state/state.service";
import { Reminder } from "../shared";
import { TIMEZONE } from "../sources/stagger";
import { ReminderRule, collectionReminders, evaluateRules } from "./rules";

const RULES_PATH = configPath("reminders.json");

/**
 * Reminders are derived and time-dependent, so they are recomputed both when
 * the collection feed changes and once a minute as the clock crosses a rule's
 * `after`/`before` boundary.
 */
@Injectable()
export class RemindersService implements OnModuleInit {
    private readonly log = new Logger(RemindersService.name);
    private rules: ReminderRule[] = [];
    private signature: string | null = null;

    constructor(private readonly state: StateService) {}

    async onModuleInit(): Promise<void> {
        await this.loadRules();
        this.state.stream.subscribe(() => this.recompute());
        this.recompute();
    }

    @Interval("reminders", 60_000)
    tick(): void {
        this.recompute();
    }

    private async loadRules(): Promise<void> {
        try {
            this.rules = JSON.parse(await fs.readFile(RULES_PATH, "utf8")) as ReminderRule[];
            this.log.log(`Loaded ${this.rules.length} reminder rules`);
        } catch (err) {
            this.log.warn(`Could not load reminder rules — ${String(err)}`);
            this.rules = [];
        }
    }

    /** Pushing re-enters the subscriber, so the signature guard ends the loop. */
    private recompute(): void {
        const now = DateTime.now().setZone(TIMEZONE);
        const events = this.state.current.collection.data ?? [];

        const reminders: Reminder[] = [
            ...collectionReminders(events, now),
            ...evaluateRules(this.rules, now),
        ];

        const signature = reminders.map((r) => `${r.id}:${r.text}`).join("|");
        if (signature === this.signature) {
            return;
        }
        this.signature = signature;
        this.state.setReminders(reminders);
    }
}
