import { and, eq, sql } from "drizzle-orm";
import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Message, type TextChannel } from "discord.js";
import { botActiveChatRewardSettingsTable, botMiningProfilesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const CHAT_CREDIT_COOLDOWN_MS = 60_000;
const CHAT_CREDIT_REWARD = 20;
const ACTIVE_CHAT_WINDOW_MS = 10 * 60_000;
const RANDOM_REWARD_INTERVAL_MS = 30 * 60_000;
const RANDOM_REWARD_ANNOUNCEMENT_DELAY_MS = 60_000;
const RANDOM_REWARD_TIERS = [
  { name: "Common", icon: "<:common:1558505660470010070>", minCredits: 500, maxCredits: 1000, weight: 750, color: 0x95a5a6 },
  { name: "Rare", icon: "<:rare:1562815035091329034>", minCredits: 1000, maxCredits: 2000, weight: 249, color: 0x3498db },
  { name: "Epic", icon: "<:epic:1558393073204076607>", minCredits: 3000, maxCredits: 5000, weight: 1, color: 0xf1c40f },
] as const;
const chatCreditCooldowns = new Map<string, number>();
const activeChatters = new Map<string, Map<string, { messageTimes: number[]; displayName: string }>>();
const lastRandomRewardAt = new Map<string, number>();
const randomRewardInProgress = new Set<string>();
const DAILY_STREAK_REWARDS = [100, 150, 200, 250, 300, 400, 500] as const;
const DAILY_COOLDOWN_MS = 24 * 60 * 60_000;
const DAILY_STREAK_WINDOW_MS = 48 * 60 * 60_000;

async function maybeAwardRandomChatReward(message: Message, now: number): Promise<void> {
  const guild = message.guild;
  if (!guild || randomRewardInProgress.has(guild.id)) return;
  if (now - (lastRandomRewardAt.get(guild.id) ?? 0) < RANDOM_REWARD_INTERVAL_MS) return;

  const chatterMap = activeChatters.get(guild.id);
  if (!chatterMap) return;
  const eligibleChatters = [...chatterMap.entries()]
    .map(([userId, chatter]) => [
      userId,
      chatter,
      chatter.messageTimes.filter((time) => now - time < ACTIVE_CHAT_WINDOW_MS).length,
    ] as const)
    .filter(([, , messageCount]) => messageCount > 20);
  if (eligibleChatters.length < 2) return;

  randomRewardInProgress.add(guild.id);
  try {
    const candidates = [...eligibleChatters];
    const winners: (typeof eligibleChatters)[number][] = [];
    for (let winnerIndex = 0; winnerIndex < 2; winnerIndex++) {
      const totalActivity = candidates.reduce((total, [, , messageCount]) => total + messageCount, 0);
      let activityPick = Math.random() * totalActivity;
      const candidateIndex = candidates.findIndex(([, , messageCount]) => {
        activityPick -= messageCount;
        return activityPick < 0;
      });
      winners.push(candidates.splice(candidateIndex, 1)[0]!);
    }
    const selectedTiers: (typeof RANDOM_REWARD_TIERS)[number][] = [];
    for (let tierIndex = 0; tierIndex < 2; tierIndex++) {
      const availableTiers = RANDOM_REWARD_TIERS.filter((tier) => !selectedTiers.includes(tier));
      let tierPick = Math.random() * availableTiers.reduce((total, tier) => total + tier.weight, 0);
      selectedTiers.push(availableTiers.find((tier) => {
        tierPick -= tier.weight;
        return tierPick < 0;
      })!);
    }
    const rewards = winners.map(([userId, chatter], index) => ({
      userId,
      chatter,
      reward: {
        ...selectedTiers[index]!,
        credits: Math.floor(
          Math.random() * (selectedTiers[index]!.maxCredits - selectedTiers[index]!.minCredits + 1),
        ) + selectedTiers[index]!.minCredits,
      },
    }));
    await db.transaction(async (tx) => {
      for (const { userId, reward } of rewards) {
        await tx.insert(botMiningProfilesTable)
          .values({ guildId: guild.id, userId, coins: reward.credits })
          .onConflictDoUpdate({
            target: [botMiningProfilesTable.guildId, botMiningProfilesTable.userId],
            set: {
              coins: sql<number>`${botMiningProfilesTable.coins} + ${reward.credits}`,
              updatedAt: new Date(now),
            },
          });
      }
    });
    lastRandomRewardAt.set(guild.id, now);

    const channelSettings = await db.select({ channelId: botActiveChatRewardSettingsTable.channelId })
      .from(botActiveChatRewardSettingsTable)
      .where(eq(botActiveChatRewardSettingsTable.guildId, guild.id));
    const rewardChannels: TextChannel[] = [];
    for (const channelSetting of channelSettings) {
      const configuredChannel = await guild.channels.fetch(channelSetting.channelId).catch((error: unknown) => {
        logger.warn({ err: error, guildId: guild.id, channelId: channelSetting.channelId }, "Could not fetch active chat reward channel");
        return null;
      });
      if (configuredChannel?.type === ChannelType.GuildText) {
        rewardChannels.push(configuredChannel);
      } else {
        logger.warn({ guildId: guild.id, channelId: channelSetting.channelId }, "Active chat reward channel is unavailable");
      }
    }

    for (const [index, { chatter, reward }] of rewards.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, RANDOM_REWARD_ANNOUNCEMENT_DELAY_MS));
      }
      const announcement = {
        embeds: [
          new EmbedBuilder()
            .setColor(reward.color)
            .setAuthor({ name: `Congratulations ${chatter.displayName}!` })
            .setDescription(`You won a ${reward.icon} **${reward.name} Reward** – <:credits:1558505663531851933> **__${reward.credits} Credits__**\nFor being active in chat.`)
            .setTimestamp(now),
        ],
        allowedMentions: { parse: [] },
      };
      if (rewardChannels.length > 0) {
        for (const rewardChannel of rewardChannels) {
          await rewardChannel.send(announcement).catch((error: unknown) => {
            logger.warn({ err: error, guildId: guild.id, channelId: rewardChannel.id }, "Could not send active chat reward announcement");
          });
        }
      } else {
        await message.reply(announcement);
      }
    }
  } catch (error) {
    logger.error({ err: error, guildId: guild.id }, "Could not award random active chatter reward");
  } finally {
    randomRewardInProgress.delete(guild.id);
  }
}

export async function handleActiveChatRewardChannelCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const manager = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!manager?.permissions.has(PermissionFlagsBits.ManageGuild) && !manager?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure the active chat reward channel.");
    return;
  }

  const action = args[0]?.toLowerCase();
  if (action === "remove" || action === "clear" || action === "off") {
    const mentionedChannel = message.mentions.channels.first();
    const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[1] ?? "")?.[1];
    try {
      if (channelId) {
        await db.delete(botActiveChatRewardSettingsTable)
          .where(and(
            eq(botActiveChatRewardSettingsTable.guildId, guild.id),
            eq(botActiveChatRewardSettingsTable.channelId, channelId),
          ));
        await message.reply(`✅ Removed <#${channelId}> from active chat reward announcement channels.`);
      } else {
        await db.delete(botActiveChatRewardSettingsTable)
          .where(eq(botActiveChatRewardSettingsTable.guildId, guild.id));
        await message.reply("✅ All active chat reward announcement channels were removed. Announcements will use the channel where chat activity triggers the reward.");
      }
    } catch (error) {
      logger.error({ err: error, guildId: guild.id, channelId }, "Failed to remove active chat reward channel");
      await message.reply("❌ Could not remove the active chat reward channel. Please try again.");
    }
    return;
  }

  const channelArgumentIndex = action === "set" ? 1 : 0;
  const mentionedChannel = message.mentions.channels.first();
  const channelId = mentionedChannel?.id ?? /^<?#?(\d{17,20})>?$/.exec(args[channelArgumentIndex] ?? "")?.[1];
  if (!channelId) {
    if (action !== "status" && args.length > 0) {
      await message.reply("Usage: `!setchatreward #channel`, `!setchatreward status`, `!setchatreward remove #channel`, or `!setchatreward remove` to clear all.");
      return;
    }
    try {
      const settings = await db.select({ channelId: botActiveChatRewardSettingsTable.channelId })
        .from(botActiveChatRewardSettingsTable)
        .where(eq(botActiveChatRewardSettingsTable.guildId, guild.id));
      await message.reply(settings.length > 0
        ? `💬 Active chat reward announcements will be sent in:\n${settings.map((setting) => `• <#${setting.channelId}>`).join("\n")}`
        : "💬 No reward channels are set. Announcements are sent where chat activity triggers the reward. Add channels with `!setchatreward #channel`.");
    } catch (error) {
      logger.error({ err: error, guildId: guild.id }, "Failed to load active chat reward channel");
      await message.reply("❌ Could not load the active chat reward channel. Please try again.");
    }
    return;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Choose a server text channel. Usage: `!setchatreward #channel`.");
    return;
  }

  try {
    await db.insert(botActiveChatRewardSettingsTable)
      .values({ guildId: guild.id, channelId: channel.id })
      .onConflictDoNothing();
    await message.reply(`✅ Added <#${channel.id}> to active chat reward announcement channels.`);
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, channelId }, "Failed to set active chat reward channel");
    await message.reply("❌ Could not save the active chat reward channel. Please try again.");
  }
}

export async function awardChatCredits(message: Message): Promise<void> {
  if (
    !message.guild ||
    message.author.bot ||
    !message.content.trim() ||
    message.content.trim().startsWith("!")
  ) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  let guildChatters = activeChatters.get(message.guild.id);
  if (!guildChatters) {
    guildChatters = new Map();
    activeChatters.set(message.guild.id, guildChatters);
  }
  const chatter = guildChatters.get(message.author.id) ?? { messageTimes: [], displayName: message.author.displayName };
  chatter.messageTimes = chatter.messageTimes.filter((time) => now - time < ACTIVE_CHAT_WINDOW_MS);
  chatter.messageTimes.push(now);
  chatter.displayName = message.member?.displayName ?? message.author.displayName;
  guildChatters.set(message.author.id, chatter);
  for (const [userId, chatter] of guildChatters) {
    if (chatter.messageTimes.length === 0) guildChatters.delete(userId);
  }

  await maybeAwardRandomChatReward(message, now);
  if (now - (chatCreditCooldowns.get(key) ?? 0) < CHAT_CREDIT_COOLDOWN_MS) return;

  try {
    await db.insert(botMiningProfilesTable)
      .values({ guildId: message.guild.id, userId: message.author.id, coins: CHAT_CREDIT_REWARD })
      .onConflictDoUpdate({
        target: [botMiningProfilesTable.guildId, botMiningProfilesTable.userId],
        set: {
          coins: sql<number>`${botMiningProfilesTable.coins} + ${CHAT_CREDIT_REWARD}`,
          updatedAt: new Date(now),
        },
      });
    chatCreditCooldowns.set(key, now);
  } catch (error) {
    logger.error(
      { err: error, guildId: message.guild.id, userId: message.author.id },
      "Failed to award chat credits",
    );
  }
}

export async function awardGameCredits(guildId: string, userId: string, credits: number): Promise<void> {
  try {
    await db.insert(botMiningProfilesTable)
      .values({ guildId, userId, coins: credits })
      .onConflictDoUpdate({
        target: [botMiningProfilesTable.guildId, botMiningProfilesTable.userId],
        set: {
          coins: sql<number>`${botMiningProfilesTable.coins} + ${credits}`,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logger.error({ err: error, guildId, userId, credits }, "Failed to award game credits");
  }
}

export async function handleDailyCommand(message: Message): Promise<void> {
    const guild = message.guild;
    if (!guild) return;

    const now = Date.now();
    try {
      const result = await db.transaction(async (tx) => {
        await tx.insert(botMiningProfilesTable)
          .values({ guildId: guild.id, userId: message.author.id })
          .onConflictDoNothing();
        const [profile] = await tx.select()
          .from(botMiningProfilesTable)
          .where(and(
            eq(botMiningProfilesTable.guildId, guild.id),
            eq(botMiningProfilesTable.userId, message.author.id),
          ))
          .for("update");
        if (!profile) throw new Error("Could not load daily credit profile");

        const elapsed = now - profile.lastDailyAt;
        if (elapsed < DAILY_COOLDOWN_MS) {
          return {
            status: "cooldown" as const,
            nextClaimAt: profile.lastDailyAt + DAILY_COOLDOWN_MS,
          };
        }

        const previousStreak = profile.activityCooldowns.dailyStreak ?? 0;
        const streak = elapsed <= DAILY_STREAK_WINDOW_MS ? Math.min(previousStreak + 1, DAILY_STREAK_REWARDS.length) : 1;
        const reward = DAILY_STREAK_REWARDS[streak - 1]!;
        await tx.update(botMiningProfilesTable)
          .set({
            coins: sql<number>`${botMiningProfilesTable.coins} + ${reward}`,
            lastDailyAt: now,
            activityCooldowns: { ...profile.activityCooldowns, dailyStreak: streak },
            updatedAt: new Date(now),
          })
          .where(and(
            eq(botMiningProfilesTable.guildId, guild.id),
            eq(botMiningProfilesTable.userId, message.author.id),
          ));
        return { status: "claimed" as const, reward, streak };
      });

      if (result.status === "cooldown") {
        await message.reply(`⏱ | ${message.member?.displayName ?? message.author.displayName}! You already claimed your daily reward. Try again <t:${Math.ceil(result.nextClaimAt / 1000)}:R>.`);
        return;
      }

      await message.reply(`🎁 Daily reward: **${result.reward} credits** <:16:1553581538074038372> — streak **${result.streak}**! Come back tomorrow to keep it going.`);
    } catch (error) {
      logger.error({ err: error, guildId: guild.id, userId: message.author.id }, "Could not process daily reward");
      await message.reply("❌ Could not process your daily reward right now. Please try again.");
  }
}
