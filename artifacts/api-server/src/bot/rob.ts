import { and, asc, eq, inArray } from "drizzle-orm";
import { type Message } from "discord.js";
import { botMiningProfilesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireGamblingChannel } from "./gamblingChannel";

const ROB_COOLDOWN_MS = 15_000;
const ROB_DAILY_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_CREDIT_BALANCE = 2_147_483_647;
const robCooldowns = new Map<string, number>();

export async function handleRobCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  if (message.content.trim().split(/\s+/)[1]?.toLowerCase() === "help") {
    await message.reply(
      "`!rob @user` — rob only credits in the target's wallet; banked credits are safe:\n" +
      "• 1–1,000: up to 100 credits (or the remaining balance if lower)\n" +
      "• 1,001–5,000: 200 credits\n" +
      "• 5,001–10,000: 300 credits\n" +
      "• 10,001–50,000: 500 credits\n" +
      "• Over 50,000: 1,000 credits\n" +
      "You can make up to 10 successful robs per UTC day, with a 15-second cooldown.",
    );
    return;
  }

  if (!(await requireGamblingChannel(message))) return;

  const targetUser = message.mentions.users.first();
  if (!targetUser || targetUser.bot || targetUser.id === message.author.id) {
    await message.reply("Usage: `!rob @user` — you cannot rob yourself or a bot.");
    return;
  }

  const target = await guild.members.fetch(targetUser.id).catch(() => null);
  if (!target) {
    await message.reply("That user is not a member of this server.");
    return;
  }

  const cooldownKey = `${guild.id}:${message.author.id}`;
  const now = Date.now();
  const cooldownUntil = robCooldowns.get(cooldownKey) ?? 0;
  if (cooldownUntil > now) {
    const nickname = message.member?.displayName ?? message.author.displayName;
    await message.reply(`⏱ | ${nickname}! Slow down and try the command again <t:${Math.ceil(cooldownUntil / 1000)}:R>`);
    return;
  }
  robCooldowns.set(cooldownKey, now + ROB_COOLDOWN_MS);

  try {
    const result = await db.transaction(async (tx) => {
      await tx.insert(botMiningProfilesTable)
        .values([
          { guildId: guild.id, userId: message.author.id },
          { guildId: guild.id, userId: target.id },
        ])
        .onConflictDoNothing();
      const profiles = await tx.select()
        .from(botMiningProfilesTable)
        .where(and(
          eq(botMiningProfilesTable.guildId, guild.id),
          inArray(botMiningProfilesTable.userId, [message.author.id, target.id]),
        ))
        .orderBy(asc(botMiningProfilesTable.userId))
        .for("update");
      const robber = profiles.find((profile) => profile.userId === message.author.id);
      const victim = profiles.find((profile) => profile.userId === target.id);
      if (!robber || !victim) throw new Error("Could not load rob profiles");
      const robDay = Math.floor(now / DAY_MS);
      const dailyRobCount = robber.activityCooldowns.robDay === robDay
        ? robber.activityCooldowns.robCount ?? 0
        : 0;
      if (dailyRobCount >= ROB_DAILY_LIMIT) {
        return { status: "daily-limit" as const, nextResetAt: (robDay + 1) * DAY_MS };
      }
      if (victim.coins <= 0) {
        return { status: "empty" as const };
      }

      const reward = victim.coins > 50_000
        ? 1_000
        : victim.coins > 10_000
          ? 500
          : victim.coins > 5_000
            ? 300
            : victim.coins > 1_000
              ? 200
              : Math.min(100, victim.coins);
      if (robber.coins + reward > MAX_CREDIT_BALANCE) return { status: "maximum" as const };
      await tx.update(botMiningProfilesTable)
        .set({
          coins: robber.coins + reward,
          activityCooldowns: {
            ...robber.activityCooldowns,
            robDay,
            robCount: dailyRobCount + 1,
          },
          updatedAt: new Date(now),
        })
        .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, robber.userId)));
      await tx.update(botMiningProfilesTable)
        .set({ coins: victim.coins - reward, updatedAt: new Date(now) })
        .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, victim.userId)));
      return { status: "success" as const, reward, balance: robber.coins + reward };
    });

    if (result.status === "empty") {
      await message.reply(`<@${target.id}> has no credits in their wallet to rob. Banked credits are safe.`);
    } else if (result.status === "daily-limit") {
      await message.reply(`⏳ You've reached your daily rob limit of ${ROB_DAILY_LIMIT}. Try again <t:${Math.ceil(result.nextResetAt / 1000)}:R> (UTC).`);
    } else if (result.status === "maximum") {
      await message.reply("That robbery would exceed your maximum credit balance.");
    } else {
      await message.reply(`💰 You robbed **${result.reward.toLocaleString()} credits** from <@${target.id}>! Balance: **${result.balance.toLocaleString()}**.`);
    }
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, userId: message.author.id, targetUserId: target.id }, "Could not process rob command");
    await message.reply("❌ Could not process the rob command right now. Please try again.");
  }
}
