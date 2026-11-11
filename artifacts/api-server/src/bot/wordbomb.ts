import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Message,
  type MessageCreateOptions,
  type TextChannel,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { botGameSettingsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { createRequire } from "node:module";
import { premiumColors, premiumMessagePayload } from "./presentation";

const _require = createRequire(import.meta.url);
const _wordList: string[] = _require("an-array-of-english-words");

// ─── Word Dictionary ───────────────────────────────────────────────────────────

const WORD_SET = new Set<string>(_wordList.map((w) => w.toLowerCase()));

function isRealWord(word: string): boolean {
  return WORD_SET.has(word.toLowerCase());
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGRAMS = [
  "ize", "ous", "ing", "tion", "ack", "ell", "ill", "ull",
  "ang", "ong", "ung", "ant", "ent", "int", "ath", "oth",
  "tra", "str", "the", "her", "ere", "and", "for", "not",
  "can", "had", "how", "man", "new", "now", "old", "our",
  "out", "own", "say", "she", "two", "way", "who", "got",
  "let", "put", "ask", "big", "day", "get", "has", "its",
  "may", "off", "run", "set", "sit", "try", "war", "ale",
  "are", "ate", "eve", "ice", "ire", "ore", "use", "ble",
  "ple", "tle", "gle", "nce", "nse", "eck", "ick", "ock",
  "uck", "ead", "eal", "eat", "eed", "een", "eep", "eer",
  "eet", "end", "est", "ide", "igh", "ind", "ine", "ink",
  "ion", "ish", "ite", "ive", "oak", "oal",
];

const LIVES = 3;
const LOBBY_TIME = 30_000;
const TURN_TIME = 10_000;
const EMBED_COLOR = premiumColors.brand;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WORDBOMB_GAME_TYPE = "wordbomb";

async function sendPremium(
  channel: TextChannel,
  payload: string | MessageCreateOptions,
) {
  return channel.send(premiumMessagePayload(payload, channel.client.user));
}

// ─── State ────────────────────────────────────────────────────────────────────

interface GameState {
  activePlayers: string[];
  allPlayers: string[];
  lives: Map<string, number>;
  scores: Map<string, number>;
  eliminated: Set<string>;
  usedWords: Set<string>;
  currentIndex: number;
  active: boolean;
}

const activeGames = new Map<string, GameState>();
const winsLeaderboard = new Map<string, Map<string, number>>();
const wordbombChannelCache = new Map<string, { expiresAt: number; channelId: string | null }>();

async function getWordbombChannelId(guildId: string): Promise<string | null | undefined> {
  const cached = wordbombChannelCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.channelId;

  try {
    const [setting] = await db.select({ channelId: botGameSettingsTable.channelId })
      .from(botGameSettingsTable)
    .where(and(
      eq(botGameSettingsTable.guildId, guildId),
      eq(botGameSettingsTable.gameType, WORDBOMB_GAME_TYPE),
    ))
      .limit(1);
    const channelId = setting?.channelId ?? null;
    wordbombChannelCache.set(guildId, { expiresAt: Date.now() + 15_000, channelId });
    return channelId;
  } catch (error) {
    logger.error({ err: error, guildId }, "Failed to load Word Bomb channel setting");
    return undefined;
  }
}

async function requireWordbombChannel(message: Message): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;
  const channelId = await getWordbombChannelId(guild.id);
  if (channelId === undefined) {
    await message.reply("❌ Could not verify the Word Bomb channel. Please try again shortly.");
    return false;
  }
  if (!channelId) {
    await message.reply("❌ Word Bomb is not configured. A server admin can set it with `!setwbchannel #channel`.");
    return false;
  }
  if (message.channel.id !== channelId) {
    await message.reply(`❌ Word Bomb commands can only be used in <#${channelId}>.`);
    return false;
  }
  return true;
}

export async function handleSetWbChannelCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure the Word Bomb channel.");
    return;
  }

  const action = args[0]?.toLowerCase();
  if (action === "status" || !args[0]) {
    const channelId = await getWordbombChannelId(guild.id);
    await message.reply(channelId === undefined
      ? "❌ Could not load the Word Bomb channel setting."
      : channelId
        ? `💣 Word Bomb channel: <#${channelId}>`
        : "💣 No Word Bomb channel is set. Use `!setwbchannel #channel`.");
    return;
  }

  if (["remove", "clear", "off"].includes(action ?? "")) {
    try {
      await db.delete(botGameSettingsTable).where(and(
        eq(botGameSettingsTable.guildId, guild.id),
        eq(botGameSettingsTable.gameType, WORDBOMB_GAME_TYPE),
      ));
      wordbombChannelCache.set(guild.id, { expiresAt: Date.now() + 15_000, channelId: null });
      await message.reply("✅ Word Bomb channel setting removed.");
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to remove Word Bomb channel setting");
      await message.reply("❌ Could not remove the Word Bomb channel setting. Please try again.");
    }
    return;
  }

  const mentionedChannel = message.mentions.channels.first();
  const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[0] ?? "")?.[1];
  if (!channelId || args.length > 1) {
    await message.reply("Usage: `!setwbchannel #channel`, `!setwbchannel status`, or `!setwbchannel remove`.");
    return;
  }
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Choose a server text channel.");
    return;
  }

  try {
    await db.insert(botGameSettingsTable)
      .values({ guildId: guild.id, gameType: WORDBOMB_GAME_TYPE, channelId: channel.id })
      .onConflictDoUpdate({
        target: [botGameSettingsTable.guildId, botGameSettingsTable.gameType],
        set: { channelId: channel.id, updatedAt: new Date() },
      });
    wordbombChannelCache.set(guild.id, { expiresAt: Date.now() + 15_000, channelId: channel.id });
    await message.reply(`✅ Word Bomb channel set to <#${channel.id}>.`);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, channelId: channel.id }, "Failed to set Word Bomb channel");
    await message.reply("❌ Could not save the Word Bomb channel. Please try again.");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randTrigram(): string {
  return TRIGRAMS[Math.floor(Math.random() * TRIGRAMS.length)];
}

function livesBar(lives: number): string {
  return "❤️".repeat(Math.max(0, lives)) + "🖤".repeat(Math.max(0, LIVES - lives));
}

function addWin(guildId: string, userId: string): void {
  if (!winsLeaderboard.has(guildId)) winsLeaderboard.set(guildId, new Map());
  const g = winsLeaderboard.get(guildId)!;
  g.set(userId, (g.get(userId) ?? 0) + 1);
}

async function getDisplayName(channel: TextChannel, userId: string): Promise<string> {
  try {
    const member = await channel.guild.members.fetch(userId);
    return member.displayName;
  } catch {
    return `<@${userId}>`;
  }
}

// ─── Turn ─────────────────────────────────────────────────────────────────────

async function runTurn(
  channel: TextChannel,
  state: GameState,
  currentId: string,
  trigram: string
): Promise<boolean> {
  let resolved = false;

  await sendPremium(channel, {
    content: `<@${currentId}>`,
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(`☕ Type a word containing the letters: **${trigram.toUpperCase()}**.`),
    ],
  });

  const answered = await new Promise<boolean>((resolve) => {
    const hardTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        collector.stop("timeout");
        resolve(false);
      }
    }, TURN_TIME);

    const collector = channel.createMessageCollector({
      filter: (m) => m.author.id === currentId && !m.author.bot,
      time: TURN_TIME,
    });

    collector.on("collect", async (m) => {
      const word = m.content.trim().toLowerCase();

      if (!/^[a-z]+$/.test(word)) return;

      if (!word.includes(trigram.toLowerCase())) {
        await m.react("❌").catch(() => {});
          await m
            .reply(
              premiumMessagePayload(
                `❌ **${word}** doesn't contain **\`${trigram.toUpperCase()}\`**!`,
                m.client.user,
              ),
            )
            .catch(() => {});
        return;
      }

      if (!isRealWord(word)) {
        await m.react("❌").catch(() => {});
        return;
      }

      if (state.usedWords.has(word)) {
        await m.react("❌").catch(() => {});
        return;
      }

      state.usedWords.add(word);
      resolved = true;
      clearTimeout(hardTimer);
      collector.stop("answered");

      await m.react("✅").catch(() => {});
      resolve(true);
    });

    collector.on("end", (_c, _reason) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(hardTimer);
        resolve(false);
      }
    });
  });

  return answered;
}

// ─── Main game loop ───────────────────────────────────────────────────────────

async function runGame(channel: TextChannel, state: GameState, guildId: string): Promise<void> {
  while (state.active) {
    state.activePlayers = state.activePlayers.filter((id) => (state.lives.get(id) ?? 0) > 0);

    if (state.activePlayers.length < 2) {
      const winnerId = state.activePlayers[0];

      if (winnerId) {
        addWin(guildId, winnerId);
        const name = await getDisplayName(channel, winnerId);
        await sendPremium(channel, {
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLOR)
              .setDescription(`🏆 **${name}** has won the game! 🏆`),
          ],
        });
      } else {
        await sendPremium(channel, {
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLOR)
              .setDescription("💀 Everyone was eliminated! No winner."),
          ],
        });
      }

      state.active = false;
      activeGames.delete(guildId);
      return;
    }

    if (state.currentIndex >= state.activePlayers.length) state.currentIndex = 0;

    const currentId = state.activePlayers[state.currentIndex];
    const trigram = randTrigram();

    const answered = await runTurn(channel, state, currentId, trigram);

    if (answered) {
      state.scores.set(currentId, (state.scores.get(currentId) ?? 0) + 1);
    } else {
      const remaining = (state.lives.get(currentId) ?? 1) - 1;
      state.lives.set(currentId, remaining);

      if (remaining <= 0) {
        state.eliminated.add(currentId);
        const name = await getDisplayName(channel, currentId);
        await sendPremium(channel, {
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLOR)
              .setDescription(`🚪 **${name}** has been **eliminated**!`),
          ],
        });
      } else {
        await sendPremium(channel, {
          embeds: [
            new EmbedBuilder()
              .setColor(EMBED_COLOR)
              .setDescription(`💥 <@${currentId}> lost a life! ${livesBar(remaining)}`),
          ],
        });
      }
    }

    state.currentIndex = (state.currentIndex + 1) % state.activePlayers.length;
    await sleep(1200);
  }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function handleWordbomb(client: Client, message: Message): Promise<void> {
  if (!message.guild || !(await requireWordbombChannel(message))) return;
  const guildId = message.guild.id;

  if (activeGames.has(guildId)) {
    await message.reply("❌ A Word Bomb game is already running in this server!");
    return;
  }

  const channel = message.channel as TextChannel;

  const lobbyMsg = await sendPremium(channel, {
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription(
          `⏰ Waiting for **players**, react with ✅ to join. The game will begin in **30** seconds.\n\n` +
          `\`GOAL:\` You have **10** seconds to say a word containing the given group of **3** letters. ` +
          `Failure to do so within the **10** seconds will lose a life. Each player has **${LIVES}** lives to begin with.\n\n` +
          `\`NOTES:\` A word can only be used **once** through the course of the game.`
        ),
    ],
  });

  await lobbyMsg.react("✅");
  await sleep(LOBBY_TIME);

  const reaction = lobbyMsg.reactions.cache.get("✅");
  const reactedUsers = reaction
    ? [...(await reaction.users.fetch()).values()].filter((u) => !u.bot)
    : [];

  if (reactedUsers.length < 2) {
    await sendPremium(channel, {
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setDescription("❌ Not enough players joined (need at least **2**). Game cancelled."),
      ],
    });
    return;
  }

  const players = reactedUsers.map((u) => u.id);
  const lives = new Map<string, number>(players.map((id) => [id, LIVES]));
  const scores = new Map<string, number>(players.map((id) => [id, 0]));

  const state: GameState = {
    activePlayers: [...players],
    allPlayers: [...players],
    lives,
    scores,
    eliminated: new Set(),
    usedWords: new Set(),
    currentIndex: 0,
    active: true,
  };

  activeGames.set(guildId, state);

  const displayNames = new Map<string, string>();
  for (const id of players) {
    displayNames.set(id, await getDisplayName(channel, id));
  }

  const playerLines = players
    .map((id) => `${livesBar(LIVES)} @${displayNames.get(id) ?? id}`)
    .join("\n");

  await sendPremium(channel, {
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("💣 Word Bomb — Starting!")
        .setDescription(`**${players.length} players** are ready!\n\n${playerLines}`),
    ],
  });

  await sleep(2000);
  await runGame(channel, state, guildId);
}

export async function handleWordbombStop(message: Message): Promise<void> {
  if (!message.guild || !(await requireWordbombChannel(message))) return;
  const guildId = message.guild.id;

  const member = message.guild.members.cache.get(message.author.id);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need the **Manage Server** permission to stop a game.");
    return;
  }

  const state = activeGames.get(guildId);
  if (!state) {
    await message.reply("❌ There is no active Word Bomb game to stop.");
    return;
  }

  state.active = false;
  activeGames.delete(guildId);
  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setDescription("🛑 The Word Bomb game has been **stopped** by a moderator."),
    ],
  });
}

export async function handleWbTop(message: Message): Promise<void> {
  if (!message.guild || !(await requireWordbombChannel(message))) return;
  const guildId = message.guild.id;

  const guildWins = winsLeaderboard.get(guildId);
  if (!guildWins || guildWins.size === 0) {
    await message.reply("📊 No Word Bomb games have been won yet in this server!");
    return;
  }

  const sorted = [...guildWins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = sorted.map(([userId, wins], i) => {
    const medal = medals[i] ?? `**${i + 1}.**`;
    return `${medal} <@${userId}> — **${wins}** win${wins !== 1 ? "s" : ""}`;
  });

  await message.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle("🏆 Word Bomb — Leaderboard")
        .setDescription(lines.join("\n"))
        .setFooter({ text: "Most Word Bomb wins in this server" }),
    ],
  });
}
