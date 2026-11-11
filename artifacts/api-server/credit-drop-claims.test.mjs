import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const apiRequire = createRequire(new URL("./package.json", import.meta.url));
const typescript = apiRequire("typescript");

function loadTypeScriptModule(relativePath, mocks = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (specifier) => Object.hasOwn(mocks, specifier) ? mocks[specifier] : apiRequire(specifier),
  }, { filename: relativePath });
  return module.exports;
}

test("credit-drop winner embed displays that user's personal claim count", async () => {
  const settingsTable = {
    guildId: "settings.guildId",
    channelId: "settings.channelId",
    activeMessageId: "settings.activeMessageId",
    activeCreditReward: "settings.activeCreditReward",
    activeCreditRarity: "settings.activeCreditRarity",
    activeReaction: "settings.activeReaction",
    activeExpiresAt: "settings.activeExpiresAt",
    totalCreditDropsClaimed: "settings.totalCreditDropsClaimed",
  };
  const profileTable = {
    guildId: "profile.guildId",
    userId: "profile.userId",
    coins: "profile.coins",
    creditDropsClaimed: "profile.creditDropsClaimed",
  };
  const columns = new Map([
    ...Object.entries(settingsTable).map(([key, column]) => [column, key]),
    ...Object.entries(profileTable).map(([key, column]) => [column, key]),
  ]);
  const settings = {
    guildId: "guild-1",
    channelId: "channel-1",
    activeMessageId: "drop-1",
    activeCreditReward: 350,
    activeCreditRarity: "Rare",
    activeReaction: "🎁",
    activeExpiresAt: Date.now() + 60_000,
    totalCreditDropsClaimed: 20,
  };
  const profile = { guildId: "guild-1", userId: "winner-1", coins: 150, creditDropsClaimed: 8 };
  const normalize = (value) => Array.isArray(value) ? value.flatMap(normalize) : value ? [value] : [];
  const rowFor = (table) => table === settingsTable ? settings : table === profileTable ? profile : null;
  const matches = (table, conditions) => {
    const row = rowFor(table);
    return row && conditions.every((condition) => {
      const key = columns.get(condition.column);
      if (condition.operator === "eq") return row[key] === condition.value;
      if (condition.operator === "notNull") return row[key] !== null && row[key] !== undefined;
      return false;
    }) ? [row] : [];
  };
  const database = {
    select(selection) {
      let table;
      let conditions = [];
      const builder = {
        from(value) { table = value; return this; },
        where(value) { conditions = normalize(value); return this; },
        for() { return this; },
        then(resolve, reject) {
          const rows = matches(table, conditions).map((row) => selection
            ? Object.fromEntries(Object.entries(selection).map(([key, column]) => [key, row[columns.get(column)]]))
            : row);
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return builder;
    },
    update(table) {
      let values = {};
      let conditions = [];
      return {
        set(nextValues) { values = nextValues; return this; },
        where(value) { conditions = normalize(value); return this; },
        then(resolve, reject) {
          const rows = matches(table, conditions);
          for (const row of rows) Object.assign(row, values);
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
    },
    insert() {
      return { values() { return this; }, async onConflictDoNothing() {} };
    },
    async transaction(callback) { return callback(this); },
  };
  class StubEmbedBuilder {
    setColor() { return this; }
    setDescription(description) { this.description = description; return this; }
    setFooter(footer) { this.footer = footer; return this; }
    setTimestamp() { return this; }
  }
  const module = loadTypeScriptModule("./src/bot/crates.ts", {
    "./guildPolicy": { ACTIVE_BOT_GUILD_ID: "545423389607591946" },
    "@workspace/db": { botCrateSettingsTable: settingsTable, botMiningProfilesTable: profileTable, db: database },
    "drizzle-orm": {
      and: (...conditions) => conditions,
      eq: (column, value) => ({ operator: "eq", column, value }),
      isNotNull: (column) => ({ operator: "notNull", column }),
      isNull: (column) => ({ operator: "isNull", column }),
    },
    "discord.js": { ChannelType: {}, EmbedBuilder: StubEmbedBuilder, PermissionFlagsBits: {} },
    "../lib/logger": { logger: { error() {}, warn() {} } },
  });
  const replies = [];
  const message = {
    id: "drop-1",
    guild: { id: "guild-1" },
    author: { id: "winner-1", bot: false },
    partial: false,
    embeds: [{ title: "Credit Drop!" }],
    async reply(payload) { replies.push(payload); },
  };
  const reaction = {
    partial: false,
    emoji: { name: "🎁" },
    message,
  };

  await module.handleCreditDropReaction(reaction, message.author);

  assert.equal(profile.coins, 500);
  assert.equal(profile.creditDropsClaimed, 9);
  assert.equal(settings.totalCreditDropsClaimed, 21);
  assert.match(replies[0].embeds[0].description, /Your Crates Claimed: `9`/);
  assert.doesNotMatch(replies[0].embeds[0].description, /`21`/);
});