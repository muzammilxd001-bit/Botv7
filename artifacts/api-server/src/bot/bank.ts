import { and, eq } from "drizzle-orm";
import { type Message } from "discord.js";
import { botMiningProfilesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const MAX_CREDIT_BALANCE = 2_147_483_647;

export async function handleBankCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const [, action, amountArgument, extraArgument] = message.content.trim().split(/\s+/);
  const normalizedAction = action?.toLowerCase();
  if (normalizedAction === "help" && !amountArgument && !extraArgument) {
    await message.reply(
      "🏦 **Bank Guide**\n" +
      "`!bank` — check your wallet and bank balances.\n" +
      "`!bank deposit <amount|all>` — move credits from your wallet into your bank.\n" +
      "`!bank withdraw <amount|all>` — move credits from your bank back into your wallet.\n" +
      "Credits in your bank are safe from robbery; only wallet credits can be robbed. Use `!credit` to check both balances.",
    );
    return;
  }
  if (extraArgument || (normalizedAction && normalizedAction !== "deposit" && normalizedAction !== "withdraw")) {
    await message.reply("Usage: `!bank help`, `!bank`, `!bank deposit <amount|all>`, or `!bank withdraw <amount|all>`.");
    return;
  }
  if (normalizedAction && !amountArgument) {
    await message.reply("Usage: `!bank deposit <amount|all>` or `!bank withdraw <amount|all>`.");
    return;
  }

  const amount = amountArgument?.toLowerCase() === "all"
    ? "all"
    : /^\d+$/.test(amountArgument ?? "") ? Number(amountArgument) : null;
  if (normalizedAction && (amount === null || (typeof amount === "number" && (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_CREDIT_BALANCE)))) {
    await message.reply("Enter a positive whole number of credits or `all`.");
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.insert(botMiningProfilesTable)
        .values({ guildId: guild.id, userId: message.author.id })
        .onConflictDoNothing();
      const [profile] = await tx.select({
        coins: botMiningProfilesTable.coins,
        bankCoins: botMiningProfilesTable.bankCoins,
      })
        .from(botMiningProfilesTable)
        .where(and(
          eq(botMiningProfilesTable.guildId, guild.id),
          eq(botMiningProfilesTable.userId, message.author.id),
        ))
        .for("update");
      if (!profile) throw new Error("Could not load bank profile");

      if (!normalizedAction) return { status: "balance" as const, wallet: profile.coins, bank: profile.bankCoins };

      const depositing = normalizedAction === "deposit";
      const sourceBalance = depositing ? profile.coins : profile.bankCoins;
      const destinationBalance = depositing ? profile.bankCoins : profile.coins;
      const requestedAmount = amount ?? 0;
      const transferAmount = requestedAmount === "all"
        ? Math.min(sourceBalance, MAX_CREDIT_BALANCE - destinationBalance)
        : requestedAmount;

      if (sourceBalance < transferAmount) {
        return { status: "insufficient" as const, sourceBalance, depositing };
      }
      if (transferAmount < 1) return { status: "maximum" as const };

      const wallet = depositing ? profile.coins - transferAmount : profile.coins + transferAmount;
      const bank = depositing ? profile.bankCoins + transferAmount : profile.bankCoins - transferAmount;
      await tx.update(botMiningProfilesTable)
        .set({ coins: wallet, bankCoins: bank, updatedAt: new Date() })
        .where(and(
          eq(botMiningProfilesTable.guildId, guild.id),
          eq(botMiningProfilesTable.userId, message.author.id),
        ));
      return { status: "transferred" as const, transferAmount, wallet, bank, depositing };
    });

    if (result.status === "balance") {
      await message.reply(`💳 Wallet: **${result.wallet.toLocaleString()}** credits · 🏦 Bank: **${result.bank.toLocaleString()}** credits\nCredits in your bank are safe from robbery.`);
    } else if (result.status === "insufficient") {
      await message.reply(`You only have **${result.sourceBalance.toLocaleString()} credits** in your ${result.depositing ? "wallet" : "bank"}.`);
    } else if (result.status === "maximum") {
      await message.reply("Your destination balance is already at the maximum credit limit.");
    } else {
      await message.reply(`✅ ${result.depositing ? "Deposited" : "Withdrew"} **${result.transferAmount.toLocaleString()} credits**.\n💳 Wallet: **${result.wallet.toLocaleString()}** · 🏦 Bank: **${result.bank.toLocaleString()}**`);
    }
  } catch (error) {
    logger.error({ err: error, guildId: guild.id, userId: message.author.id }, "Could not process bank command");
    await message.reply("❌ Could not process your bank command right now. Please try again.");
  }
}
