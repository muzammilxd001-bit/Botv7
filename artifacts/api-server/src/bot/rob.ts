import { and, asc, eq, inArray } from "drizzle-orm";
import { type Message } from "discord.js";
import { botMiningProfilesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { requireGamblingChannel } from "./gamblingChannel";

const ROB_COOLDOWN_MS = 15_000;
const MIN_TARGET_BALANCE = 50_000;
const MIN_REWARD = 100;
const MAX_REWARD = 1_000;
const FAILURE_FINE = 100;
const MAX_CREDIT_BALANCE = 2_147_483_647;
const robCooldowns = new Map<string, number>();

export async function handleRobCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  if (!(await requireGamblingChannel(message))) {
    await message.reply("❌ Gambling commands can only be used in the configured gambling channel.");
    return;
  }

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
      if (victim.coins < MIN_TARGET_BALANCE) {
        return { status: "protected" as const, balance: victim.coins };
      }

      const success = Math.random() < 0.5;
      if (!success) {
        const balance = Math.max(0, robber.coins - FAILURE_FINE);
        await tx.update(botMiningProfilesTable)
          .set({ coins: balance, updatedAt: new Date(now) })
          .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, robber.userId)));
        return { status: "failed" as const, fine: Math.min(FAILURE_FINE, robber.coins), balance };
      }

      const reward = Math.floor(Math.random() * (MAX_REWARD - MIN_REWARD + 1)) + MIN_REWARD;
      if (robber.coins + reward > MAX_CREDIT_BALANCE) return { status: "maximum" as const };
      await tx.update(botMiningProfilesTable)
        .set({ coins: robber.coins + reward, updatedAt: new Date(now) })
        .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, robber.userId)));
      await tx.update(botMiningProfilesTable)
        .set({ coins: victim.coins - reward, updatedAt: new Date(now) })
        .where(and(eq(botMiningProfilesTable.guildId, guild.id), eq(botMiningProfilesTable.userId, victim.userId)));
      return { status: "success" as const, reward, balance: robber.coins + reward };
    });

    if (result.status === "protected") {
      await message.reply(`<@${target.id}> is too poor to rob. They need at least **${MIN_TARGET_BALANCE.toLocaleString()} credits**.`);
    } else if (result.status === "failed") {
      await message.reply(`🚨 The rob failed! You lost **${result.fine.toLocaleString()} credits**.`);
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
