import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Message,
  type MessageReaction,
  type User,
} from "discord.js";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  botCrateSettingsTable,
  botMiningProfilesTable,
  db,
} from "@workspace/db";
import { logger } from "../lib/logger";

const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 0;
const MAX_INTERVAL_MINUTES = 24 * 60;
const CRATE_LIFETIME_MS = 10 * 60_000;
const SCHEDULER_INTERVAL_MS = 30_000;
export const DROP_REACTIONS = ["🌦️", "🎁", "🍀", "💎", "⭐", "🪙", "🎈", "🍉"] as const;
const LEGACY_REACTION = "🌦️";
export const CREDIT_DROP_TIERS = [
  { name: "Common", icon: "<:common:1558505660470010070>", min: 100, max: 200, weight: 70, color: 0x95a5a6 },
  { name: "Rare", icon: "<:rare:1562815035091329034>", min: 200, max: 500, weight: 25, color: 0x3498db },
  { name: "Epic", icon: "🌌", min: 500, max: 1000, weight: 5, color: 0xf1c40f },
] as const;
export type CreditDropTier = (typeof CREDIT_DROP_TIERS)[number];

export function chooseCreditDropReward(): {
  tier: (typeof CREDIT_DROP_TIERS)[number];
  creditReward: number;
} {
  let tierPick = Math.random() * CREDIT_DROP_TIERS.reduce((total, tier) => total + tier.weight, 0);
  const tier = CREDIT_DROP_TIERS.find((candidate) => {
    tierPick -= candidate.weight;
    return tierPick < 0;
  }) ?? CREDIT_DROP_TIERS[0];
  const creditReward = Math.floor(Math.random() * (tier.max - tier.min + 1)) + tier.min;
  return { tier, creditReward };
}

let scheduler: NodeJS.Timeout | undefined;
let schedulerRunning = false;

function creditDropEmbed(
  expiresAt: number,
  reaction: string,
  tier: CreditDropTier,
  creditReward: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(tier.color)
    .setAuthor({ name: "A Mysterious Crate Has Appeared!" })
    .setDescription(
      "<:click:1558393065616707674> **React** to this message with the emoji below to win!\n\n" +
      `<:reaction:1558393068254666785>  **Reaction:** ${reaction}\n` +
      "<:trophy:1558393071224365102>  **First valid reaction wins!**\n\n" +
      `${tier.icon} **Rarity:** ${tier.name}\n` +
      `<:reward:1558393075829702726> **Reward:** ${creditReward} Credits\n` +
      `<:time:1558393079851917372> **Expires:** <t:${Math.floor(expiresAt / 1000)}:R>`,
    );
}

function parseInterval(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)(m|h)$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = amount * (match[2]!.toLowerCase() === "h" ? 60 : 1);
  return Number.isInteger(minutes) &&
    minutes >= MIN_INTERVAL_MINUTES &&
    minutes <= MAX_INTERVAL_MINUTES
    ? minutes
    : null;
}

async function getCreditDropSettings(guildId: string, channelId?: string) {
  return db
    .select()
    .from(botCrateSettingsTable)
    .where(channelId
      ? and(
          eq(botCrateSettingsTable.guildId, guildId),
          eq(botCrateSettingsTable.channelId, channelId),
        )
      : eq(botCrateSettingsTable.guildId, guildId));
}

export async function handleCreditDropCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply("❌ You need **Manage Server** permission to configure credit drops.");
    return;
  }

  const [, action = "status", ...args] = message.content.trim().split(/\s+/);
  const normalizedAction = action.toLowerCase();
  try {
    if (normalizedAction === "status") {
      const settings = await getCreditDropSettings(guild.id);
      if (settings.length === 0) {
        await message.reply("Credit drops are not configured. Use `!creditdrop setup #channel`.");
        return;
      }
      const statusLines = settings.map((setting) =>
        `Channel: <#${setting.channelId}>\nInterval: ${setting.intervalMinutes} minutes\nStatus: ${setting.enabled ? "enabled" : "paused"}\nNext drop: ${setting.enabled ? `<t:${Math.floor(setting.nextCrateAt / 1000)}:R>` : "paused"}\nActive drop: ${setting.activeMessageId ? `expires <t:${Math.floor((setting.activeExpiresAt ?? 0) / 1000)}:R>` : "none"}\nTotal claimed: ${setting.totalCreditDropsClaimed.toLocaleString()}`
      );
      let statusMessage = "**Credit drop settings**";
      for (const statusLine of statusLines) {
        if (statusMessage.length + statusLine.length + 2 > 1800) {
          await message.reply(statusMessage);
          statusMessage = "**Credit drop settings (continued)**";
        }
        statusMessage += `\n\n${statusLine}`;
      }
      await message.reply(statusMessage);
      return;
    }

    if (normalizedAction === "setup") {
      const mentioned = message.mentions.channels.first();
      const channel = mentioned ? guild.channels.cache.get(mentioned.id) : undefined;
      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply("Usage: `!creditdrop setup #text-channel [30m]`.");
        return;
      }
      const intervalArgument = args.find((argument) => argument !== `<#${channel.id}>`);
      const intervalMinutes = intervalArgument
        ? parseInterval(intervalArgument)
        : DEFAULT_INTERVAL_MINUTES;
      if (intervalMinutes === null) {
        await message.reply(`❌ Interval must be ${MIN_INTERVAL_MINUTES}m–24h, for example \`30m\` or \`2h\`.`);
        return;
      }
      const [existing] = await getCreditDropSettings(guild.id, channel.id);
      const now = Date.now();
      if (existing?.activeMessageId) {
        const previousChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
        const previousDrop = previousChannel?.isTextBased()
          ? await previousChannel.messages.fetch(existing.activeMessageId).catch(() => null)
          : null;
        if (previousDrop?.author.id === message.client.user?.id) {
          await previousDrop.delete().catch((error: unknown) => {
            logger.warn({ err: error, guildId: guild.id, messageId: existing.activeMessageId }, "Could not remove the previous scheduled drop");
          });
        }
      }
      await db
        .insert(botCrateSettingsTable)
        .values({
          guildId: guild.id,
          channelId: channel.id,
          intervalMinutes,
          enabled: true,
          nextCrateAt: now + intervalMinutes * 60_000,
        })
        .onConflictDoUpdate({
          target: [botCrateSettingsTable.guildId, botCrateSettingsTable.channelId],
          set: {
            channelId: channel.id,
            intervalMinutes,
            enabled: true,
            nextCrateAt: now + intervalMinutes * 60_000,
            activeMessageId: null,
            activeCreditReward: null,
            activeCreditRarity: null,
            activeReaction: null,
            activeExpiresAt: null,
            updatedAt: new Date(now),
          },
        });
      await message.reply(
        `✅ Credit drops are enabled in ${channel}, every ${intervalMinutes} minutes. The first drop appears after that interval.`,
      );
      return;
    }

    if (normalizedAction === "remove") {
      const channel = message.mentions.channels.first();
      if (!channel || channel.type !== ChannelType.GuildText) {
        await message.reply("Usage: `!creditdrop remove #channel`.");
        return;
      }
      const [settings] = await getCreditDropSettings(guild.id, channel.id);
      if (!settings) {
        await message.reply(`❌ Credit drops are not configured in ${channel}.`);
        return;
      }
      if (settings.activeMessageId) {
        const activeChannel = await guild.channels.fetch(settings.channelId).catch(() => null);
        const activeDrop = activeChannel?.isTextBased()
          ? await activeChannel.messages.fetch(settings.activeMessageId).catch(() => null)
          : null;
        if (activeDrop?.author.id === message.client.user?.id) {
          await activeDrop.delete().catch((error: unknown) => {
            logger.warn({ err: error, guildId: guild.id, messageId: settings.activeMessageId }, "Could not remove the active credit drop");
          });
        }
      }
      await db.delete(botCrateSettingsTable).where(and(
        eq(botCrateSettingsTable.guildId, guild.id),
        eq(botCrateSettingsTable.channelId, channel.id),
      ));
      await message.reply(`✅ Credit drops removed from ${channel}.`);
      return;
    }

    if (normalizedAction === "interval") {
      const intervalArgument = args.find((argument) => parseInterval(argument) !== null);
      const intervalMinutes = parseInterval(intervalArgument);
      if (intervalMinutes === null) {
        await message.reply(`Usage: \`!creditdrop interval 1h [#channel]\` (allowed: ${MIN_INTERVAL_MINUTES}m–24h).`);
        return;
      }
      const channel = message.mentions.channels.first();
      if (channel && channel.type !== ChannelType.GuildText) {
        await message.reply("❌ Choose a server text channel.");
        return;
      }
      const settings = await getCreditDropSettings(guild.id, channel?.id);
      if (settings.length === 0) {
        await message.reply("❌ Configure a channel first with `!creditdrop setup #channel`.");
        return;
      }
      const now = Date.now();
      for (const setting of settings) {
        await db.update(botCrateSettingsTable)
          .set({
            intervalMinutes,
            nextCrateAt: now + intervalMinutes * 60_000,
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botCrateSettingsTable.guildId, guild.id),
            eq(botCrateSettingsTable.channelId, setting.channelId),
          ));
      }
      await message.reply(channel
        ? `✅ Credit drop interval for ${channel} set to ${intervalMinutes} minutes.`
        : `✅ Credit drop interval set to ${intervalMinutes} minutes for all configured channels.`);
      return;
    }

    if (normalizedAction === "pause" || normalizedAction === "resume") {
      const enabled = normalizedAction === "resume";
      const channel = message.mentions.channels.first();
      if (channel && channel.type !== ChannelType.GuildText) {
        await message.reply("❌ Choose a server text channel.");
        return;
      }
      const settings = await getCreditDropSettings(guild.id, channel?.id);
      if (settings.length === 0) {
        await message.reply("❌ Configure a channel first with `!creditdrop setup #channel`.");
        return;
      }
      const now = Date.now();
      for (const setting of settings) {
        await db.update(botCrateSettingsTable)
          .set({
            enabled,
            ...(enabled ? { nextCrateAt: now + setting.intervalMinutes * 60_000 } : {}),
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botCrateSettingsTable.guildId, guild.id),
            eq(botCrateSettingsTable.channelId, setting.channelId),
          ));
      }
      await message.reply(channel
        ? `✅ Credit drops ${enabled ? "resumed" : "paused"} in ${channel}.`
        : `✅ Credit drops ${enabled ? "resumed" : "paused"} in all configured channels.`);
      return;
    }

    await message.reply("Usage: `!creditdrop setup #channel [30m]`, `!creditdrop remove #channel`, `!creditdrop interval 1h [#channel]`, `!creditdrop status`, `!creditdrop pause [#channel]`, or `!creditdrop resume [#channel]`.");
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, action: normalizedAction }, "Credit drop settings command failed");
    await message.reply("❌ Could not update credit drop settings. Please try again.");
  }
}

async function spawnCreditDrop(
  client: Client,
  settings: typeof botCrateSettingsTable.$inferSelect,
): Promise<void> {
  const channel = await client.channels.fetch(settings.channelId);
  if (!channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) {
    throw new Error(`Configured credit drop channel ${settings.channelId} is unavailable or not a text channel`);
  }
  const expiresAt = Date.now() + CRATE_LIFETIME_MS;
  const { tier, creditReward } = chooseCreditDropReward();
  const reaction = DROP_REACTIONS[Math.floor(Math.random() * DROP_REACTIONS.length)]!;
  const message = await channel.send({ embeds: [creditDropEmbed(expiresAt, reaction, tier, creditReward)] });
  try {
    await message.react(reaction);
    await db.update(botCrateSettingsTable)
      .set({
        activeMessageId: message.id,
        activeCreditReward: creditReward,
        activeCreditRarity: tier.name,
        activeReaction: reaction,
        activeExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(botCrateSettingsTable.guildId, settings.guildId),
        eq(botCrateSettingsTable.channelId, settings.channelId),
      ));
  } catch (error) {
    await message.delete().catch(() => {});
    throw error;
  }
}

async function runScheduler(client: Client): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const settingsList = await db
      .select()
      .from(botCrateSettingsTable)
      .where(eq(botCrateSettingsTable.enabled, true));
    const now = Date.now();
    for (const settings of settingsList) {
      if (settings.activeMessageId && (settings.activeExpiresAt ?? 0) <= now) {
        await db.update(botCrateSettingsTable)
          .set({
            activeMessageId: null,
            activeCreditReward: null,
            activeCreditRarity: null,
            activeReaction: null,
            activeExpiresAt: null,
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botCrateSettingsTable.guildId, settings.guildId),
            eq(botCrateSettingsTable.channelId, settings.channelId),
            eq(botCrateSettingsTable.activeMessageId, settings.activeMessageId),
          ));
      }
      if (settings.activeMessageId || settings.nextCrateAt > now) continue;

      const nextCrateAt = now + settings.intervalMinutes * 60_000;
      const [claimed] = await db.update(botCrateSettingsTable)
        .set({ nextCrateAt, updatedAt: new Date(now) })
        .where(and(
          eq(botCrateSettingsTable.guildId, settings.guildId),
          eq(botCrateSettingsTable.channelId, settings.channelId),
          eq(botCrateSettingsTable.enabled, true),
          eq(botCrateSettingsTable.nextCrateAt, settings.nextCrateAt),
          isNull(botCrateSettingsTable.activeMessageId),
        ))
        .returning({ guildId: botCrateSettingsTable.guildId, channelId: botCrateSettingsTable.channelId });
      if (!claimed) continue;

      try {
        await spawnCreditDrop(client, settings);
      } catch (error) {
        logger.error({ err: error, guildId: settings.guildId, channelId: settings.channelId }, "Could not spawn scheduled credit drop");
      }
    }
  } finally {
    schedulerRunning = false;
  }
}

export function startCreditDropScheduler(client: Client): void {
  if (scheduler) return;
  scheduler = setInterval(() => {
    void runScheduler(client).catch((error: unknown) => {
      logger.error({ err: error }, "Credit drop scheduler failed");
    });
  }, SCHEDULER_INTERVAL_MS);
  scheduler.unref();
  void runScheduler(client).catch((error: unknown) => {
    logger.error({ err: error }, "Initial credit drop scheduler run failed");
  });
}

export async function handleCreditDropReaction(reaction: MessageReaction, user: User): Promise<void> {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  if (reaction.message.partial) await reaction.message.fetch();
  if (!reaction.message.guild) return;
  if (!reaction.message.embeds.some((embed) =>
    embed.author?.name === "A Mysterious Crate Has Appeared!" ||
    embed.title === "Credit Drop!" ||
    embed.title === "A Credit Drop Has Appeared!"
  )) return;

  const now = Date.now();
  const result = await db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(botCrateSettingsTable)
      .where(and(
        eq(botCrateSettingsTable.guildId, reaction.message.guild!.id),
        eq(botCrateSettingsTable.activeMessageId, reaction.message.id),
        isNotNull(botCrateSettingsTable.activeMessageId),
      ))
      .for("update");
    if (
      !settings ||
      !settings.activeCreditReward ||
      !settings.activeExpiresAt ||
      settings.activeExpiresAt <= now
    ) {
      return null;
    }
    const expectedReaction = settings.activeReaction ?? LEGACY_REACTION;
    if (reaction.emoji.name !== expectedReaction) return null;

    await tx.insert(botMiningProfilesTable)
      .values({ guildId: settings.guildId, userId: user.id })
      .onConflictDoNothing();
    const [profile] = await tx.select({
      coins: botMiningProfilesTable.coins,
      creditDropsClaimed: botMiningProfilesTable.creditDropsClaimed,
    })
      .from(botMiningProfilesTable)
      .where(and(
        eq(botMiningProfilesTable.guildId, settings.guildId),
        eq(botMiningProfilesTable.userId, user.id),
      ))
      .for("update");
    if (!profile) throw new Error("Could not load credit balance for drop winner");
    const credits = settings.activeCreditReward;
    const tier = CREDIT_DROP_TIERS.find((candidate) => candidate.name === settings.activeCreditRarity)
      ?? CREDIT_DROP_TIERS.find((candidate) => credits >= candidate.min && credits <= candidate.max)
      ?? CREDIT_DROP_TIERS[0];
    const balance = profile.coins + credits;
    const userCreditDropsClaimed = profile.creditDropsClaimed + 1;
    await tx.update(botMiningProfilesTable)
      .set({ coins: balance, creditDropsClaimed: userCreditDropsClaimed, updatedAt: new Date(now) })
      .where(and(
        eq(botMiningProfilesTable.guildId, settings.guildId),
        eq(botMiningProfilesTable.userId, user.id),
      ));
    const totalCreditDropsClaimed = settings.totalCreditDropsClaimed + 1;
    await tx.update(botCrateSettingsTable)
      .set({
        activeMessageId: null,
        activeCreditReward: null,
        activeCreditRarity: null,
        activeReaction: null,
        activeExpiresAt: null,
        totalCreditDropsClaimed,
        updatedAt: new Date(now),
      })
      .where(and(
        eq(botCrateSettingsTable.guildId, settings.guildId),
        eq(botCrateSettingsTable.channelId, settings.channelId),
      ));
    return { credits, balance, userCreditDropsClaimed, tier };
  });

  if (!result) return;
  try {
    await reaction.message.reply({
      content: `<@${user.id}>`,
      embeds: [
        new EmbedBuilder()
          .setColor(result.tier.color)
          .setDescription(
            `${result.tier.icon} **${result.tier.name}** · <@${user.id}> received <:credits:1558505663531851933> **__${result.credits}__** **credits!**\n\n` +
            `<a:gift:1558505667038289990> Your Crates Claimed: \`${result.userCreditDropsClaimed.toLocaleString()}\`\n` +
            "Use `!credits` to view your credits",
          )
          .setFooter({ text: "This reward is given randomly to an active chatter" })
          .setTimestamp(new Date(now)),
      ],
      allowedMentions: { users: [user.id] },
    });
  } catch (error) {
    logger.error(
      { err: error, guildId: reaction.message.guild.id, userId: user.id, messageId: reaction.message.id },
      "Could not announce crate winner",
    );
  }
}
