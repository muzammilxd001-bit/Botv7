import { ChannelType, PermissionFlagsBits, type Message } from "discord.js";
import { eq } from "drizzle-orm";
import { botCommandBlacklistSettingsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const CACHE_DURATION_MS = 10_000;
const channelCache = new Map<string, { channelId: string | null; expiresAt: number }>();

async function getBlacklistedChannelId(guildId: string): Promise<string | null> {
  const cached = channelCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.channelId;

  const [setting] = await db.select({ channelId: botCommandBlacklistSettingsTable.channelId })
    .from(botCommandBlacklistSettingsTable)
    .where(eq(botCommandBlacklistSettingsTable.guildId, guildId))
    .limit(1);
  const channelId = setting?.channelId ?? null;
  channelCache.set(guildId, { channelId, expiresAt: Date.now() + CACHE_DURATION_MS });
  return channelId;
}

export async function shouldIgnoreCommands(guildId: string, channelId: string): Promise<boolean> {
  try {
    return await getBlacklistedChannelId(guildId) === channelId;
  } catch (err) {
    logger.error({ err, guildId, channelId }, "Failed to verify command blacklist channel");
    return true;
  }
}

export async function handleSetCommandBlacklistChannel(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure the command blacklist channel.");
    return;
  }

  const action = args[0]?.toLowerCase();
  if (action === "remove" || action === "clear" || action === "off") {
    try {
      await db.delete(botCommandBlacklistSettingsTable)
        .where(eq(botCommandBlacklistSettingsTable.guildId, guild.id));
      channelCache.delete(guild.id);
      await message.reply("✅ Command blacklist channel removed. Bot commands are enabled in all channels.");
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "Failed to remove command blacklist channel");
      await message.reply("❌ Could not remove the command blacklist channel. Please try again.");
    }
    return;
  }

  const mentionedChannel = message.mentions.channels.first();
  const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[0] ?? "")?.[1];
  if (!channelId) {
    if (action === "status" || !args[0]) {
      try {
        const configuredChannelId = await getBlacklistedChannelId(guild.id);
        await message.reply(configuredChannelId
          ? `🚫 Bot commands are disabled in <#${configuredChannelId}>.`
          : "🚫 No command blacklist channel is configured.");
      } catch (err) {
        logger.error({ err, guildId: guild.id }, "Failed to load command blacklist channel");
        await message.reply("❌ Could not load the command blacklist channel setting. Please try again.");
      }
      return;
    }
    await message.reply("Usage: `!setblacklistchannel #channel`, `!setblacklistchannel status`, or `!setblacklistchannel remove`.");
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Please choose a text channel from this server.");
    return;
  }

  try {
    await db.insert(botCommandBlacklistSettingsTable)
      .values({ guildId: guild.id, channelId: channel.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: botCommandBlacklistSettingsTable.guildId,
        set: { channelId: channel.id, updatedAt: new Date() },
      });
    channelCache.set(guild.id, { channelId: channel.id, expiresAt: Date.now() + CACHE_DURATION_MS });
    await message.reply(`✅ Bot commands will be ignored in <#${channel.id}>.`);
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId: channel.id }, "Failed to set command blacklist channel");
    await message.reply("❌ Could not set the command blacklist channel. Please try again.");
  }
}
