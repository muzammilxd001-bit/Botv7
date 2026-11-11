import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const botCommandBlacklistSettingsTable = pgTable("bot_command_blacklist_settings", {
  guildId: text("guild_id").primaryKey(),
  channelId: text("channel_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
