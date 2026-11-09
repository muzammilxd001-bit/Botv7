import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const botMiningProfilesTable = pgTable(
  "bot_mining_profiles",
  {
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    coins: integer("coins").notNull().default(0),
    bankCoins: integer("bank_coins").notNull().default(0),
    creditDropsClaimed: integer("credit_drops_claimed").notNull().default(0),
    inventory: jsonb("inventory").$type<Record<string, number>>().notNull().default({}),
    equipment: jsonb("equipment").$type<Record<string, number>>().notNull().default({}),
    pickaxeLevel: integer("pickaxe_level").notNull().default(1),
    backpackLevel: integer("backpack_level").notNull().default(0),
    experience: integer("experience").notNull().default(0),
    lastMineAt: bigint("last_mine_at", { mode: "number" }).notNull().default(0),
    lastDailyAt: bigint("last_daily_at", { mode: "number" }).notNull().default(0),
    activityCooldowns: jsonb("activity_cooldowns").$type<Record<string, number>>().notNull().default({}),
    questDate: text("quest_date").notNull().default(""),
    questMines: integer("quest_mines").notNull().default(0),
    questSellValue: integer("quest_sell_value").notNull().default(0),
    questClaimed: boolean("quest_claimed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.guildId, table.userId] })],
);