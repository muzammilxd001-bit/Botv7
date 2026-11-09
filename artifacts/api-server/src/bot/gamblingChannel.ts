import { ChannelType, PermissionFlagsBits, type Message } from "discord.js";
import { eq } from "drizzle-orm";
import { botGamblingSettingsTable, db } from "@workspace/db";

export async function handleSetGamblingCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure the gambling channel.");
    return;
  }

  const action = args[0]?.toLowerCase();
  if (action === "remove" || action === "clear" || action === "off") {
    await db.delete(botGamblingSettingsTable).where(eq(botGamblingSettingsTable.guildId, guild.id));
    await message.reply("✅ Gambling channel restriction removed.");
    return;
  }

  const channel = message.mentions.channels.first();
  if (!channel && (action === "status" || !args[0])) {
    const [setting] = await db.select({ channelId: botGamblingSettingsTable.channelId })
      .from(botGamblingSettingsTable)
      .where(eq(botGamblingSettingsTable.guildId, guild.id))
      .limit(1);
    await message.reply(setting ? `🎰 Gambling commands are restricted to <#${setting.channelId}>.` : "🎰 No gambling channel is configured.");
    return;
  }
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("Usage: `!setgambling #channel`, `!setgambling status`, or `!setgambling remove`.");
    return;
  }

  await db.insert(botGamblingSettingsTable)
    .values({ guildId: guild.id, channelId: channel.id })
    .onConflictDoUpdate({
      target: botGamblingSettingsTable.guildId,
      set: { channelId: channel.id, updatedAt: new Date() },
    });
  await message.reply(`✅ Gambling commands are now restricted to <#${channel.id}>.`);
}

export async function requireGamblingChannel(message: Message): Promise<boolean> {
  if (!message.guild) return false;
  const [setting] = await db.select({ channelId: botGamblingSettingsTable.channelId })
    .from(botGamblingSettingsTable)
    .where(eq(botGamblingSettingsTable.guildId, message.guild.id))
    .limit(1);
  if (!setting || setting.channelId === message.channel.id) return true;

  await message.reply(`❌ Gambling commands can only be used in <#${setting.channelId}>. Play them there. A server manager configured this with \`!setgambling #channel\`.`);
  return false;
}
