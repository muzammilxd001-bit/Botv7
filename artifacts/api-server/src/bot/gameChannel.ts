import { ChannelType, PermissionFlagsBits, type Message, type TextChannel } from "discord.js";
import { and, eq, like, or } from "drizzle-orm";
import { botGameSettingsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const CONFIG_CACHE_MS = 15_000;
const LEGACY_GAME_TYPE = "legacy";
const LEGACY_GAME_TYPE_PREFIX = "legacy-";
const gameChannelCache = new Map<string, { expiresAt: number; channelIds: string[] }>();

async function getGameChannelIds(guildId: string): Promise<string[] | undefined> {
  const cached = gameChannelCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.channelIds;

  try {
    const settings = await db
      .select({ channelId: botGameSettingsTable.channelId })
      .from(botGameSettingsTable)
      .where(and(
        eq(botGameSettingsTable.guildId, guildId),
        or(
          eq(botGameSettingsTable.gameType, LEGACY_GAME_TYPE),
          like(botGameSettingsTable.gameType, `${LEGACY_GAME_TYPE_PREFIX}%`),
        ),
      ));
    const channelIds = [...new Set(settings.map((setting) => setting.channelId))];
    gameChannelCache.set(guildId, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelIds });
    return channelIds;
  } catch (err) {
    logger.error({ err, guildId }, "Failed to load game channel settings");
    return undefined;
  }
}

export async function requireGameChannel(message: Message): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;

  const channelIds = await getGameChannelIds(guild.id);
  if (channelIds === undefined) {
    await message.reply("❌ Could not verify the game channel. Please try again shortly.");
    return false;
  }
  if (channelIds.length === 0) {
    await message.reply("❌ Games are not configured. A server admin can add channels with `!setgame #channel`.");
    return false;
  }
  if (!channelIds.includes(message.channel.id)) {
    await message.reply(`❌ Games can only be played in ${channelIds.map((channelId) => `<#${channelId}>`).join(", ")}.`);
    return false;
  }
  return true;
}

export async function handleSetGameCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure the game channel.");
    return;
  }

  const action = args[0]?.toLowerCase();
  if (action === "remove" || action === "clear" || action === "off") {
    const mentionedChannel = message.mentions.channels.first();
    const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[1] ?? "")?.[1];
    try {
      if (channelId) {
        await db.delete(botGameSettingsTable).where(and(
          eq(botGameSettingsTable.guildId, guild.id),
          eq(botGameSettingsTable.channelId, channelId),
          or(
            eq(botGameSettingsTable.gameType, LEGACY_GAME_TYPE),
            eq(botGameSettingsTable.gameType, `${LEGACY_GAME_TYPE_PREFIX}${channelId}`),
          ),
        ));
        gameChannelCache.delete(guild.id);
        const channelIds = await getGameChannelIds(guild.id);
        if (channelIds) {
          gameChannelCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelIds });
        }
        await message.reply(`✅ Removed <#${channelId}> from the game channels.`);
      } else {
        await db.delete(botGameSettingsTable).where(and(
          eq(botGameSettingsTable.guildId, guild.id),
          or(
            eq(botGameSettingsTable.gameType, LEGACY_GAME_TYPE),
            like(botGameSettingsTable.gameType, `${LEGACY_GAME_TYPE_PREFIX}%`),
          ),
        ));
        gameChannelCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelIds: [] });
        await message.reply("✅ All game channels were cleared. Add one with `!setgame #channel`.");
      }
    } catch (err) {
      logger.error({ err, guildId: guild.id, channelId }, "Failed to remove game channel setting");
      await message.reply("❌ Could not remove the game channel setting. Please try again.");
    }
    return;
  }

  const mentionedChannel = message.mentions.channels.first();
  const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[0] ?? "")?.[1];
  if (!channelId) {
    const configuredChannelIds = await getGameChannelIds(guild.id);
    if (action === "status" || !args[0]) {
      await message.reply(configuredChannelIds === undefined
        ? "❌ Could not load the game channel settings."
        : configuredChannelIds.length > 0
          ? `🎮 Game channels:\n${configuredChannelIds.map((id) => `• <#${id}>`).join("\n")}`
          : "🎮 No game channels are set. Use `!setgame #channel` to add one.");
      return;
    }
    await message.reply("Usage: `!setgame #channel` (repeat to add channels), `!setgame status`, `!setgame remove #channel`, or `!setgame remove` to clear all.");
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Choose a server text channel. Usage: `!setgame #channel`.");
    return;
  }

  try {
    const gameType = `${LEGACY_GAME_TYPE_PREFIX}${channel.id}`;
    await db.insert(botGameSettingsTable)
      .values({ guildId: guild.id, gameType, channelId: channel.id })
      .onConflictDoUpdate({
        target: [botGameSettingsTable.guildId, botGameSettingsTable.gameType],
        set: { channelId: channel.id, updatedAt: new Date() },
      });
    gameChannelCache.delete(guild.id);
    const channelIds = await getGameChannelIds(guild.id);
    if (channelIds) {
      gameChannelCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelIds });
    }
    await message.reply(`✅ ${channel as TextChannel} added to game channels. Use \`!setgame status\` to see all configured channels.`);
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId }, "Failed to set game channel");
    await message.reply("❌ Could not save the game channel. Please try again.");
  }
}