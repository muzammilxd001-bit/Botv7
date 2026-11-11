import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Message,
  type TextChannel,
} from "discord.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  botFlagDropSettingsTable,
  botMiningProfilesTable,
  db,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { ACTIVE_BOT_GUILD_ID } from "./guildPolicy";
import { findFlagCountry, FLAG_COUNTRIES, isCorrectFlagCountryAnswer } from "./flagCountries";
import { CREDIT_DROP_TIERS, chooseCreditDropReward, type CreditDropTier } from "./crates";

const DEFAULT_INTERVAL_MINUTES = 15;
const MIN_INTERVAL_MINUTES = 0;
const MAX_INTERVAL_MINUTES = 24 * 60;
const FLAG_DROP_LIFETIME_MS = 10 * 60_000;
const SCHEDULER_INTERVAL_MS = 30_000;
const CORRECT_ANSWER_EMOJI = "<:tick:1563231751432704131>";
const EMBED_COLOR = 0x3498db;

let scheduler: NodeJS.Timeout | undefined;
let schedulerRunning = false;

function flagDropEmbed(countryCode: string, expiresAt: number, tier: CreditDropTier, creditReward: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(tier.color)
    .setAuthor({ name: "A Mysterious Crate Has Appeared!" })
    .setTitle("Country Flag Drop!")
    .setDescription(
      "<a:chat:1563228192259575929> **Name** the **__country__** shown by the flag in chat to win!\n\n" +
      "<:world:1563228194247802882> Which **__country__** does this **flag** belong to?\n" +
      "<:trophy:1558393071224365102> **First correct answer wins!**\n\n" +
      `${tier.icon} **Rarity:** ${tier.name}\n` +
      `<:reward:1558393075829702726> **Reward:** ${creditReward} Credits\n` +
      `<:time:1558393079851917372> **Expires:** <t:${Math.floor(expiresAt / 1000)}:R>`,
    )
    .setImage(`https://flagcdn.com/w320/${countryCode}.png`);
}

function parseInterval(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)(m|h)$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = amount * (match[2]!.toLowerCase() === "h" ? 60 : 1);
  return Number.isSafeInteger(minutes) && minutes >= MIN_INTERVAL_MINUTES && minutes <= MAX_INTERVAL_MINUTES
    ? minutes
    : null;
}

async function getFlagDropSettings(guildId: string, channelId?: string) {
  return db
    .select()
    .from(botFlagDropSettingsTable)
    .where(channelId
      ? and(
          eq(botFlagDropSettingsTable.guildId, guildId),
          eq(botFlagDropSettingsTable.channelId, channelId),
        )
      : eq(botFlagDropSettingsTable.guildId, guildId));
}

export async function handleFlagDropCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to configure flag drops.");
    return;
  }

  const [, action = "status", ...args] = message.content.trim().split(/\s+/);
  const normalizedAction = action.toLowerCase();
  try {
    if (normalizedAction === "status") {
      const settings = await getFlagDropSettings(guild.id);
      if (settings.length === 0) {
        await message.reply("Flag drops are not configured. Use `!flagdrop setup #channel`.");
        return;
      }
      const lines = settings.map((setting) =>
        `Channel: <#${setting.channelId}>\nInterval: ${setting.intervalMinutes} minutes\nStatus: ${setting.enabled ? "enabled" : "paused"}\nNext drop: ${setting.enabled ? `<t:${Math.floor(setting.nextDropAt / 1000)}:R>` : "paused"}\nActive: ${setting.activeMessageId ? `expires <t:${Math.floor((setting.activeExpiresAt ?? 0) / 1000)}:R>` : "none"}\nWinners: ${setting.totalWinners.toLocaleString()}`
      );
      let statusMessage = "**Flag drop settings**";
      for (const line of lines) {
        if (statusMessage.length + line.length + 2 > 1800) {
          await message.reply(statusMessage);
          statusMessage = "**Flag drop settings (continued)**";
        }
        statusMessage += `\n\n${line}`;
      }
      await message.reply(statusMessage);
      return;
    }

    if (normalizedAction === "setup") {
      const mentioned = message.mentions.channels.first();
      const channel = mentioned ? guild.channels.cache.get(mentioned.id) : undefined;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply("Usage: `!flagdrop setup #text-channel [15m]`.");
        return;
      }
      const intervalArgument = args.find((argument) => argument !== `<#${channel.id}>`);
      const intervalMinutes = intervalArgument ? parseInterval(intervalArgument) : DEFAULT_INTERVAL_MINUTES;
      if (intervalMinutes === null) {
        await message.reply(`❌ Interval must be ${MIN_INTERVAL_MINUTES}m–24h, for example \`15m\` or \`2h\`.`);
        return;
      }
      const [existing] = await getFlagDropSettings(guild.id, channel.id);
      if (existing?.activeMessageId) {
        const activeChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
        const activeMessage = activeChannel?.isTextBased()
          ? await activeChannel.messages.fetch(existing.activeMessageId).catch(() => null)
          : null;
        if (activeMessage?.author.id === message.client.user?.id) {
          await activeMessage.delete().catch((error: unknown) => {
            logger.warn({ err: error, guildId: guild.id, messageId: existing.activeMessageId }, "Could not remove the previous flag drop");
          });
        }
      }

      const now = Date.now();
      await db.insert(botFlagDropSettingsTable)
        .values({
          guildId: guild.id,
          channelId: channel.id,
          intervalMinutes,
          enabled: true,
          nextDropAt: now + intervalMinutes * 60_000,
        })
        .onConflictDoUpdate({
          target: [botFlagDropSettingsTable.guildId, botFlagDropSettingsTable.channelId],
          set: {
            intervalMinutes,
            enabled: true,
            nextDropAt: now + intervalMinutes * 60_000,
            activeMessageId: null,
            activeCountryCode: null,
            activeCreditReward: null,
            activeCreditRarity: null,
            activeExpiresAt: null,
            updatedAt: new Date(now),
          },
        });
      await message.reply(`✅ Flag drops enabled in ${channel}, every ${intervalMinutes} minutes.`);
      return;
    }

    if (normalizedAction === "remove") {
      const channel = message.mentions.channels.first();
      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply("Usage: `!flagdrop remove #channel`.");
        return;
      }
      const [setting] = await getFlagDropSettings(guild.id, channel.id);
      if (!setting) {
        await message.reply(`❌ Flag drops are not configured in ${channel}.`);
        return;
      }
      if (setting.activeMessageId) {
        const activeChannel = await guild.channels.fetch(setting.channelId).catch(() => null);
        const activeMessage = activeChannel?.isTextBased()
          ? await activeChannel.messages.fetch(setting.activeMessageId).catch(() => null)
          : null;
        if (activeMessage?.author.id === message.client.user?.id) {
          await activeMessage.delete().catch(() => {});
        }
      }
      await db.delete(botFlagDropSettingsTable).where(and(
        eq(botFlagDropSettingsTable.guildId, guild.id),
        eq(botFlagDropSettingsTable.channelId, channel.id),
      ));
      await message.reply(`✅ Flag drops removed from ${channel}.`);
      return;
    }

    if (normalizedAction === "interval") {
      const intervalArgument = args.find((argument) => parseInterval(argument) !== null);
      const intervalMinutes = parseInterval(intervalArgument);
      if (intervalMinutes === null) {
        await message.reply(`Usage: \`!flagdrop interval 1h [#channel]\` (allowed: ${MIN_INTERVAL_MINUTES}m–24h).`);
        return;
      }
      const channel = message.mentions.channels.first();
      if (channel && channel.type !== ChannelType.GuildText) {
        await message.reply("❌ Choose a server text channel.");
        return;
      }
      const settings = await getFlagDropSettings(guild.id, channel?.id);
      if (settings.length === 0) {
        await message.reply("❌ Configure a channel first with `!flagdrop setup #channel`.");
        return;
      }
      const now = Date.now();
      for (const setting of settings) {
        await db.update(botFlagDropSettingsTable)
          .set({ intervalMinutes, nextDropAt: now + intervalMinutes * 60_000, updatedAt: new Date(now) })
          .where(and(
            eq(botFlagDropSettingsTable.guildId, guild.id),
            eq(botFlagDropSettingsTable.channelId, setting.channelId),
          ));
      }
      await message.reply(channel
        ? `✅ Flag drop interval for ${channel} set to ${intervalMinutes} minutes.`
        : `✅ Flag drop interval set to ${intervalMinutes} minutes for all configured channels.`);
      return;
    }

    if (normalizedAction === "pause" || normalizedAction === "resume") {
      const enabled = normalizedAction === "resume";
      const channel = message.mentions.channels.first();
      if (channel && channel.type !== ChannelType.GuildText) {
        await message.reply("❌ Choose a server text channel.");
        return;
      }
      const settings = await getFlagDropSettings(guild.id, channel?.id);
      if (settings.length === 0) {
        await message.reply("❌ Configure a channel first with `!flagdrop setup #channel`.");
        return;
      }
      const now = Date.now();
      for (const setting of settings) {
        await db.update(botFlagDropSettingsTable)
          .set({
            enabled,
            ...(enabled ? { nextDropAt: now + setting.intervalMinutes * 60_000 } : {}),
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botFlagDropSettingsTable.guildId, guild.id),
            eq(botFlagDropSettingsTable.channelId, setting.channelId),
          ));
      }
      await message.reply(channel
        ? `✅ Flag drops ${enabled ? "resumed" : "paused"} in ${channel}.`
        : `✅ Flag drops ${enabled ? "resumed" : "paused"} in all configured channels.`);
      return;
    }

    await message.reply("Usage: `!flagdrop setup #channel [15m]`, `!flagdrop remove #channel`, `!flagdrop interval 1h [#channel]`, `!flagdrop status`, `!flagdrop pause [#channel]`, or `!flagdrop resume [#channel]`.");
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, action: normalizedAction }, "Flag drop settings command failed");
    await message.reply("❌ Could not update flag drop settings. Please try again.");
  }
}

async function spawnFlagDrop(client: Client, setting: typeof botFlagDropSettingsTable.$inferSelect): Promise<void> {
  const channel = await client.channels.fetch(setting.channelId);
  if (!channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) {
    throw new Error(`Configured flag drop channel ${setting.channelId} is unavailable or not a text channel`);
  }
  const country = FLAG_COUNTRIES[Math.floor(Math.random() * FLAG_COUNTRIES.length)]!;
  const { tier, creditReward } = chooseCreditDropReward();
  const expiresAt = Date.now() + FLAG_DROP_LIFETIME_MS;
  const dropMessage = await channel.send({ embeds: [flagDropEmbed(country.code, expiresAt, tier, creditReward)] });
  try {
    const [updated] = await db.update(botFlagDropSettingsTable)
      .set({
        activeMessageId: dropMessage.id,
        activeCountryCode: country.code,
        activeCreditReward: creditReward,
        activeCreditRarity: tier.name,
        activeExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(botFlagDropSettingsTable.guildId, setting.guildId),
        eq(botFlagDropSettingsTable.channelId, setting.channelId),
        isNull(botFlagDropSettingsTable.activeMessageId),
      ))
      .returning({ activeMessageId: botFlagDropSettingsTable.activeMessageId });
    if (!updated) throw new Error("Flag drop configuration changed before activation");
  } catch (error) {
    await dropMessage.delete().catch(() => {});
    throw error;
  }
}

async function runFlagDropScheduler(client: Client): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const settingsList = await db.select().from(botFlagDropSettingsTable)
      .where(and(
        eq(botFlagDropSettingsTable.enabled, true),
        eq(botFlagDropSettingsTable.guildId, ACTIVE_BOT_GUILD_ID),
      ));
    const now = Date.now();
    for (const setting of settingsList) {
      if (setting.activeMessageId && (setting.activeExpiresAt ?? 0) <= now) {
        await db.update(botFlagDropSettingsTable)
          .set({
            activeMessageId: null,
            activeCountryCode: null,
            activeCreditReward: null,
            activeCreditRarity: null,
            activeExpiresAt: null,
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botFlagDropSettingsTable.guildId, setting.guildId),
            eq(botFlagDropSettingsTable.channelId, setting.channelId),
            eq(botFlagDropSettingsTable.activeMessageId, setting.activeMessageId),
          ));
      }
      if (setting.activeMessageId || setting.nextDropAt > now) continue;

      const nextDropAt = now + setting.intervalMinutes * 60_000;
      const [reserved] = await db.update(botFlagDropSettingsTable)
        .set({ nextDropAt, updatedAt: new Date(now) })
        .where(and(
          eq(botFlagDropSettingsTable.guildId, setting.guildId),
          eq(botFlagDropSettingsTable.channelId, setting.channelId),
          eq(botFlagDropSettingsTable.enabled, true),
          eq(botFlagDropSettingsTable.nextDropAt, setting.nextDropAt),
          isNull(botFlagDropSettingsTable.activeMessageId),
        ))
        .returning({ channelId: botFlagDropSettingsTable.channelId });
      if (!reserved) continue;

      try {
        await spawnFlagDrop(client, setting);
      } catch (error) {
        logger.error({ err: error, guildId: setting.guildId, channelId: setting.channelId }, "Could not spawn scheduled flag drop");
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

export function startFlagDropScheduler(client: Client): void {
  if (scheduler) return;
  scheduler = setInterval(() => {
    void runFlagDropScheduler(client).catch((error: unknown) => {
      logger.error({ err: error }, "Flag drop scheduler failed");
    });
  }, SCHEDULER_INTERVAL_MS);
  scheduler.unref();
  void runFlagDropScheduler(client).catch((error: unknown) => {
    logger.error({ err: error }, "Initial flag drop scheduler run failed");
  });
}

export async function handleFlagDropAnswer(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.content.trim().startsWith("!")) return;
  const answer = message.content.trim();
  if (!answer) return;

  const now = Date.now();
  const result = await db.transaction(async (tx) => {
    const [setting] = await tx.select().from(botFlagDropSettingsTable)
      .where(and(
        eq(botFlagDropSettingsTable.guildId, message.guild!.id),
        eq(botFlagDropSettingsTable.channelId, message.channelId),
        isNotNull(botFlagDropSettingsTable.activeMessageId),
      ))
      .for("update");
    if (!setting?.activeMessageId || !setting.activeCountryCode || !setting.activeCreditReward) return null;
    if ((setting.activeExpiresAt ?? 0) <= now) {
      await tx.update(botFlagDropSettingsTable)
        .set({ activeMessageId: null, activeCountryCode: null, activeCreditReward: null, activeCreditRarity: null, activeExpiresAt: null, updatedAt: new Date(now) })
        .where(and(
          eq(botFlagDropSettingsTable.guildId, setting.guildId),
          eq(botFlagDropSettingsTable.channelId, setting.channelId),
        ));
      return null;
    }
    if (!isCorrectFlagCountryAnswer(setting.activeCountryCode, answer)) return null;

    const country = findFlagCountry(setting.activeCountryCode);
    if (!country) return null;
    const tier = CREDIT_DROP_TIERS.find((candidate) => candidate.name === setting.activeCreditRarity);
    if (!tier) return null;
    await tx.insert(botMiningProfilesTable)
      .values({ guildId: setting.guildId, userId: message.author.id })
      .onConflictDoNothing();
    const [profile] = await tx.select().from(botMiningProfilesTable)
      .where(and(
        eq(botMiningProfilesTable.guildId, setting.guildId),
        eq(botMiningProfilesTable.userId, message.author.id),
      ))
      .for("update");
    if (!profile) throw new Error("Could not load profile for flag-drop winner");

    const creditReward = setting.activeCreditReward;
    const balance = profile.coins + creditReward;
    await tx.update(botMiningProfilesTable)
      .set({ coins: balance, updatedAt: new Date(now) })
      .where(and(
        eq(botMiningProfilesTable.guildId, setting.guildId),
        eq(botMiningProfilesTable.userId, message.author.id),
      ));
    await tx.update(botFlagDropSettingsTable)
      .set({
        activeMessageId: null,
        activeCountryCode: null,
        activeCreditReward: null,
        activeCreditRarity: null,
        activeExpiresAt: null,
        totalWinners: setting.totalWinners + 1,
        updatedAt: new Date(now),
      })
      .where(and(
        eq(botFlagDropSettingsTable.guildId, setting.guildId),
        eq(botFlagDropSettingsTable.channelId, setting.channelId),
        eq(botFlagDropSettingsTable.activeMessageId, setting.activeMessageId),
      ));
    return { balance, country, messageId: setting.activeMessageId, tier, creditReward };
  });

  if (!result) return;
  await message.react(CORRECT_ANSWER_EMOJI).catch((error: unknown) => {
    logger.warn({ err: error, guildId: message.guildId, messageId: message.id }, "Could not react to the correct flag answer");
  });
  try {
    const challenge = await message.channel.messages.fetch(result.messageId).catch(() => null);
    if (challenge?.embeds[0]) {
      await challenge.edit({
        embeds: [EmbedBuilder.from(challenge.embeds[0])
          .setTitle("Country Flag Drop Complete!")
          .setDescription(`${result.tier.icon} **${result.tier.name}** · <@${message.author.id}> guessed **${result.country.name}** and won **${result.creditReward} Credits**!`)],
      }).catch((error: unknown) => {
        logger.warn({ err: error, guildId: message.guildId, messageId: result.messageId }, "Could not mark the flag drop as complete");
      });
    }
    await message.reply({
      content: `<:trophy:1558393071224365102> Correct! The flag belongs to **${result.country.name}**. You won **${result.creditReward} Credits**. Your balance is **${result.balance.toLocaleString()} Credits**.`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.error({ err: error, guildId: message.guildId, channelId: message.channelId, userId: message.author.id }, "Could not announce flag-drop winner");
  }
}