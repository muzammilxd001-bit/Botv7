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

const countryLogic = loadTypeScriptModule("./src/bot/flagCountries.ts");

function createAnswerHarness({ answer = "Japan", expiresAt = Date.now() + 60_000, countryCode = "jp" } = {}) {
  const settingsTable = {
    guildId: "settings.guildId",
    channelId: "settings.channelId",
    activeMessageId: "settings.activeMessageId",
    activeCountryCode: "settings.activeCountryCode",
    activeCreditReward: "settings.activeCreditReward",
    activeCreditRarity: "settings.activeCreditRarity",
    activeExpiresAt: "settings.activeExpiresAt",
    totalWinners: "settings.totalWinners",
  };
  const profileTable = {
    guildId: "profile.guildId",
    userId: "profile.userId",
    coins: "profile.coins",
  };
  const columns = new Map([
    ...Object.entries(settingsTable).map(([key, column]) => [column, key]),
    ...Object.entries(profileTable).map(([key, column]) => [column, key]),
  ]);
  const settingRows = [{
    guildId: "guild-1",
    channelId: "channel-1",
    activeMessageId: "challenge-1",
    activeCountryCode: countryCode,
    activeCreditReward: 350,
    activeCreditRarity: "Rare",
    activeExpiresAt: expiresAt,
    totalWinners: 0,
  }];
  const profileRows = [{ guildId: "guild-1", userId: "user-1", coins: 125 }];
  const rowsFor = (table) => table === settingsTable ? settingRows : table === profileTable ? profileRows : [];
  const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten) : value ? [value] : [];
  const matchingRows = (table, conditions) => rowsFor(table).filter((row) => conditions.every((condition) => {
    const key = columns.get(condition.column);
    if (condition.operator === "eq") return row[key] === condition.value;
    if (condition.operator === "notNull") return row[key] !== null && row[key] !== undefined;
    if (condition.operator === "isNull") return row[key] === null || row[key] === undefined;
    return false;
  }));

  const database = {
    select() {
      let table;
      let conditions = [];
      const builder = {
        from(value) { table = value; return this; },
        where(value) { conditions = flatten(value); return this; },
        for() { return this; },
        limit(count) { return Promise.resolve(matchingRows(table, conditions).slice(0, count)); },
        then(resolve, reject) { return Promise.resolve(matchingRows(table, conditions)).then(resolve, reject); },
      };
      return builder;
    },
    update(table) {
      let values = {};
      let conditions = [];
      const builder = {
        set(nextValues) { values = nextValues; return this; },
        where(value) { conditions = flatten(value); return this; },
        then(resolve, reject) {
          const matched = matchingRows(table, conditions);
          for (const row of matched) Object.assign(row, values);
          return Promise.resolve(matched).then(resolve, reject);
        },
      };
      return builder;
    },
    insert(table) {
      let values;
      return {
        values(input) { values = input; return this; },
        async onConflictDoNothing() {
          const rows = rowsFor(table);
          const found = rows.some((row) => row.guildId === values.guildId && row.userId === values.userId);
          if (!found) rows.push({ ...values });
        },
      };
    },
    async transaction(callback) { return callback(this); },
  };

  class StubEmbedBuilder {
    static from(embed) { return new StubEmbedBuilder().setTitle(embed.title ?? "").setDescription(embed.description ?? ""); }
    setColor() { return this; }
    setTitle(title) { this.title = title; return this; }
    setDescription(description) { this.description = description; return this; }
    setImage(url) { this.image = url; return this; }
  }

  const flagDrop = loadTypeScriptModule("./src/bot/flagDrop.ts", {
    "./guildPolicy": { ACTIVE_BOT_GUILD_ID: "545423389607591946" },
    "@workspace/db": {
      botFlagDropSettingsTable: settingsTable,
      botMiningProfilesTable: profileTable,
      db: database,
    },
    "drizzle-orm": {
      and: (...conditions) => conditions,
      eq: (column, value) => ({ operator: "eq", column, value }),
      isNotNull: (column) => ({ operator: "notNull", column }),
      isNull: (column) => ({ operator: "isNull", column }),
    },
    "discord.js": {
      ChannelType: { GuildText: 0 },
      EmbedBuilder: StubEmbedBuilder,
      PermissionFlagsBits: { ManageGuild: 1 },
    },
    "../lib/logger": { logger: { error() {}, warn() {} } },
    "./flagCountries": countryLogic,
    "./crates": {
      CREDIT_DROP_TIERS: [
        { name: "Common", icon: "common", min: 100, max: 200, weight: 70, color: 0x95a5a6 },
        { name: "Rare", icon: "rare", min: 200, max: 500, weight: 25, color: 0x3498db },
        { name: "Epic", icon: "epic", min: 500, max: 1000, weight: 5, color: 0xf1c40f },
      ],
      chooseCreditDropReward: () => ({
        tier: { name: "Rare", icon: "rare", min: 200, max: 500, weight: 25, color: 0x3498db },
        creditReward: 350,
      }),
    },
  });

  const replies = [];
  const reactions = [];
  const challenge = {
    embeds: [{ title: "Country Flag Drop!", description: "Guess the country", image: "flag.png" }],
    async edit(payload) { this.embeds = payload.embeds; },
  };
  const channel = {
    messages: { async fetch() { return challenge; } },
  };
  const message = {
    guild: { id: "guild-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    channel,
    author: { id: "user-1", bot: false },
    content: answer,
    async react(emoji) { reactions.push(emoji); },
    async reply(payload) { replies.push(payload); },
  };

  return { ...flagDrop, challenge, message, profileRows, reactions, replies, settingRows };
}

test("flag answers normalize accents, casing, and common aliases", () => {
  assert.equal(countryLogic.isCorrectFlagCountryAnswer("us", "  USA! "), true);
  assert.equal(countryLogic.isCorrectFlagCountryAnswer("gb", "great britain"), true);
  assert.equal(countryLogic.isCorrectFlagCountryAnswer("tr", "TURKIYE"), true);
  assert.equal(countryLogic.isCorrectFlagCountryAnswer("jp", "South Korea"), false);
});

test("wrong answers do not consume the flag drop or award credits", async () => {
  const harness = createAnswerHarness({ answer: "Canada" });
  await harness.handleFlagDropAnswer(harness.message);

  assert.equal(harness.profileRows[0].coins, 125);
  assert.equal(harness.settingRows[0].activeMessageId, "challenge-1");
  assert.equal(harness.replies.length, 0);
});

test("first correct country answer gets its saved rarity reward and closes the drop", async () => {
  const harness = createAnswerHarness({ answer: "  JAPAN! " });
  await harness.handleFlagDropAnswer(harness.message);

  assert.equal(harness.profileRows[0].coins, 475);
  assert.equal(harness.settingRows[0].activeMessageId, null);
  assert.equal(harness.settingRows[0].activeCountryCode, null);
  assert.equal(harness.settingRows[0].activeCreditReward, null);
  assert.equal(harness.settingRows[0].activeCreditRarity, null);
  assert.equal(harness.settingRows[0].totalWinners, 1);
  assert.equal(harness.challenge.embeds[0].title, "Country Flag Drop Complete!");
  assert.match(harness.replies[0].content, /350 Credits/);
  assert.deepEqual(harness.reactions, ["<:tick:1563231751432704131>"]);

  await harness.handleFlagDropAnswer(harness.message);
  assert.equal(harness.profileRows[0].coins, 475);
  assert.equal(harness.replies.length, 1);
});

test("expired flag drops are cleared without awarding credits", async () => {
  const harness = createAnswerHarness({ expiresAt: Date.now() - 1 });
  await harness.handleFlagDropAnswer(harness.message);

  assert.equal(harness.profileRows[0].coins, 125);
  assert.equal(harness.settingRows[0].activeMessageId, null);
  assert.equal(harness.settingRows[0].activeCountryCode, null);
  assert.equal(harness.settingRows[0].activeCreditReward, null);
  assert.equal(harness.settingRows[0].activeCreditRarity, null);
  assert.equal(harness.replies.length, 0);
});