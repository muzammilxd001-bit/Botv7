import { ChannelType, PermissionFlagsBits, type ChatInputCommandInteraction, type Message, type TextChannel } from "discord.js";
import { and, eq } from "drizzle-orm";
import { botGameSettingsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const COMMAND_CHANNEL_SETTING = "commands";
const CONFIG_CACHE_MS = 15_000;
const commandChannelCache = new Map<string, { expiresAt: number; channelId: string | null }>();

export async function getCommandChannelId(guildId: string): Promise<string | null | undefined> {
  const cached = commandChannelCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.channelId;

  try {
    const [setting] = await db
      .select({ channelId: botGameSettingsTable.channelId })
      .from(botGameSettingsTable)
      .where(and(
        eq(botGameSettingsTable.guildId, guildId),
        eq(botGameSettingsTable.gameType, COMMAND_CHANNEL_SETTING),
      ))
      .limit(1);
    const channelId = setting?.channelId ?? null;
    commandChannelCache.set(guildId, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelId });
    return channelId;
  } catch (error) {
    logger.error({ err: error, guildId }, "Failed to load bot command channel");
    return undefined;
  }
}

export async function requireCommandChannel(message: Message): Promise<boolean> {
  const guild = message.guild;
  if (!guild) return false;

  const channelId = await getCommandChannelId(guild.id);
  if (channelId === undefined) {
    await message.reply("❌ Could not verify the bot commands channel. Please try again shortly.");
    return false;
  }
  if (!channelId) {
    await message.reply("❌ The bot commands channel is not configured. A server admin can set it with `!setcommandchannel #channel`.");
    return false;
  }
  if (message.channel.id !== channelId) {
    await message.reply(`❌ Bot commands can only be used in <#${channelId}>.`);
    return false;
  }
  return true;
}

export async function requireCommandChannelForInteraction(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "❌ This command can only be used inside a server.", ephemeral: true });
    return false;
  }
  const channelId = await getCommandChannelId(guildId);
  if (channelId === undefined) {
    await interaction.reply({ content: "❌ Could not verify the bot commands channel. Please try again shortly.", ephemeral: true });
    return false;
  }
  if (!channelId) {
    await interaction.reply({ content: "❌ The bot commands channel is not configured. A server admin can set it with `!setcommandchannel #channel`.", ephemeral: true });
    return false;
  }
  if (interaction.channelId !== channelId) {
    await interaction.reply({ content: `❌ Bot commands can only be used in <#${channelId}>.`, ephemeral: true });
    return false;
  }
  return true;
}

export async function handleSetCommandChannelCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure the bot commands channel.");
    return;
  }

  const action = args[0]?.toLowerCase();
  if (action === "status" || !args[0]) {
    const channelId = await getCommandChannelId(guild.id);
    await message.reply(channelId === undefined
      ? "❌ Could not load the bot commands channel setting."
      : channelId
        ? `🤖 Bot commands are restricted to <#${channelId}>.`
        : "🤖 No bot commands channel is set. Use `!setcommandchannel #channel`.");
    return;
  }

  if (action === "remove" || action === "clear" || action === "off") {
    try {
      await db.delete(botGameSettingsTable).where(and(
        eq(botGameSettingsTable.guildId, guild.id),
        eq(botGameSettingsTable.gameType, COMMAND_CHANNEL_SETTING),
      ));
      commandChannelCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelId: null });
      await message.reply("✅ The bot commands channel restriction was removed.");
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to remove bot commands channel");
      await message.reply("❌ Could not remove the bot commands channel setting. Please try again.");
    }
    return;
  }

  const mentionedChannel = message.mentions.channels.first();
  const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[0])?.[1];
  if (!channelId) {
    await message.reply("Usage: `!setcommandchannel #channel`, `!setcommandchannel status`, or `!setcommandchannel remove`.");
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Choose a server text channel. Usage: `!setcommandchannel #channel`.");
    return;
  }

  try {
    await db.insert(botGameSettingsTable)
      .values({ guildId: guild.id, gameType: COMMAND_CHANNEL_SETTING, channelId: channel.id })
      .onConflictDoUpdate({
        target: [botGameSettingsTable.guildId, botGameSettingsTable.gameType],
        set: { channelId: channel.id, updatedAt: new Date() },
      });
    commandChannelCache.set(guild.id, { expiresAt: Date.now() + CONFIG_CACHE_MS, channelId: channel.id });
    await message.reply(`✅ Bot commands will now only work in ${channel as TextChannel}.`);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, channelId }, "Failed to set bot commands channel");
    await message.reply("❌ Could not save the bot commands channel. Please try again.");
  }
}
