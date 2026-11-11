import { and, eq, lte } from "drizzle-orm";
import { ChannelType, EmbedBuilder, PermissionFlagsBits, type Client, type Message } from "discord.js";
import { botBumpSettingsTable, botScheduledMessagesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { ACTIVE_BOT_GUILD_ID } from "./guildPolicy";

const MAX_DURATION_MS = 7 * 24 * 60 * 60_000;
const MAX_ACTIVE_PER_USER = 10;
const SCHEDULER_INTERVAL_MS = 5_000;
let scheduler: NodeJS.Timeout | undefined;
let schedulerRunning = false;

function parseDuration(value: string | undefined): number | null {
  const match = /^(\d+)(s|m|h|d)$/i.exec(value ?? "");
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!.toLowerCase() as "s" | "m" | "h" | "d"];
  const duration = amount * multiplier;
  return Number.isSafeInteger(duration) && duration >= 1_000 && duration <= MAX_DURATION_MS
    ? duration
    : null;
}

async function reply(message: Message, title: string, description: string): Promise<void> {
  await message.reply({
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description)],
    allowedMentions: { parse: [], repliedUser: false },
  });
}

async function countActive(guildId: string, userId: string, kind: string): Promise<number> {
  const entries = await db.select({ id: botScheduledMessagesTable.id })
    .from(botScheduledMessagesTable)
    .where(and(
      eq(botScheduledMessagesTable.guildId, guildId),
      eq(botScheduledMessagesTable.userId, userId),
      eq(botScheduledMessagesTable.kind, kind),
    ))
    .limit(MAX_ACTIVE_PER_USER);
  return entries.length;
}

async function saveScheduledMessage(
  message: Message,
  kind: "reminder" | "timer",
  duration: number,
  content: string,
): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const activeCount = await countActive(guild.id, message.author.id, kind);
  if (activeCount >= MAX_ACTIVE_PER_USER) {
    await reply(message, "Too many scheduled messages", `You can have up to ${MAX_ACTIVE_PER_USER} active ${kind}s at once.`);
    return;
  }

  const dueAt = new Date(Date.now() + duration);
  await db.insert(botScheduledMessagesTable).values({
    guildId: guild.id,
    userId: message.author.id,
    channelId: message.channelId,
    kind,
    content,
    dueAt,
  });

  await reply(
    message,
    kind === "reminder" ? "Reminder set" : "Timer started",
    `${content}\n<t:${Math.floor(dueAt.getTime() / 1000)}:R>`,
  );
}

export async function handleReminderCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const action = message.content.trim().split(/\s+/, 3)[1]?.toLowerCase();

  if (action === "clear") {
    const removed = await db.delete(botScheduledMessagesTable)
      .where(and(
        eq(botScheduledMessagesTable.guildId, guild.id),
        eq(botScheduledMessagesTable.userId, message.author.id),
        eq(botScheduledMessagesTable.kind, "reminder"),
      ))
      .returning({ id: botScheduledMessagesTable.id });
    await reply(message, "Reminders cleared", `Cancelled ${removed.length} active reminder(s).`);
    return;
  }

  if (action !== "start") {
    await reply(message, "Reminder commands", "Use `!reminder start <duration> <text>` or `!reminder clear`. Duration: `30s`, `5m`, `2h`, or up to `7d`.");
    return;
  }

  const payload = message.content.trim().replace(/^!?reminder\s+start\s*/i, "");
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(payload);
  const duration = parseDuration(match?.[1]);
  const content = match?.[2]?.trim();
  if (!duration || !content) {
    await reply(message, "Invalid reminder", "Usage: `!reminder start <duration> <text>`; for example, `!reminder start 30m drink water`.");
    return;
  }

  await saveScheduledMessage(message, "reminder", duration, content.slice(0, 1000));
}

export async function handleTimerCommand(message: Message): Promise<void> {
  if (!message.guild || (message.channel.type !== ChannelType.GuildText && message.channel.type !== ChannelType.GuildAnnouncement)) {
    await reply(message, "Timer needs a server text channel", "Run `!timer <duration> [message]` in a server text channel.");
    return;
  }

  const payload = message.content.trim().replace(/^!?timer\s*/i, "");
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(payload);
  const duration = parseDuration(match?.[1]);
  if (!duration) {
    await reply(message, "Invalid timer", "Usage: `!timer <duration> [message]`; for example, `!timer 10m break` (maximum `7d`).");
    return;
  }

  await saveScheduledMessage(message, "timer", duration, match?.[2]?.trim().slice(0, 1000) || "Timer finished.");
}

const DISBOARD_BOT_ID = "302050872383242240";
const BUMP_INTERVAL_MS = 2 * 60 * 60_000;

export async function handleBumpCommand(message: Message): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has(PermissionFlagsBits.ManageGuild) && !member?.permissions.has(PermissionFlagsBits.Administrator)) {
    await message.reply("❌ You need **Manage Server** permission to configure bump role mentions.");
    return;
  }

  const [, action = "status"] = message.content.trim().split(/\s+/);
  if (action.toLowerCase() === "remove" || action.toLowerCase() === "clear") {
    await db.delete(botBumpSettingsTable).where(eq(botBumpSettingsTable.guildId, guild.id));
    await message.reply("✅ Bump role mentions removed.");
    return;
  }
  if (action.toLowerCase() === "roles" || action.toLowerCase() === "set") {
    const roleIds = [...new Set(message.mentions.roles.map((role) => role.id))];
    if (roleIds.length === 0) {
      await message.reply("Usage: `!bump roles @role1 @role2`.");
      return;
    }
    await db.insert(botBumpSettingsTable)
      .values({ guildId: guild.id, roleIds })
      .onConflictDoUpdate({
        target: botBumpSettingsTable.guildId,
        set: { roleIds, updatedAt: new Date() },
      });
    await message.reply(`✅ Bump reminders will mention ${roleIds.map((roleId) => `<@&${roleId}>`).join(", ")}.`);
    return;
  }

  const [settings] = await db.select({ roleIds: botBumpSettingsTable.roleIds })
    .from(botBumpSettingsTable)
    .where(eq(botBumpSettingsTable.guildId, guild.id))
    .limit(1);
  await message.reply(settings?.roleIds.length
    ? `📣 Bump reminders mention: ${settings.roleIds.map((roleId) => `<@&${roleId}>`).join(", ")}`
    : "📣 No bump roles are configured. Use `!bump roles @role1 @role2` or `!bump remove`.");
}

export async function handleBumpMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.id !== DISBOARD_BOT_ID) return;
  const text = message.embeds.map((e) => e.description ?? "").join("\n");
  if (!/bump done/i.test(text)) return;

  const bumper = message.interactionMetadata?.user ?? message.interaction?.user;
  const channelId = message.channelId;
  const [bumpSettings] = await db.select({ roleIds: botBumpSettingsTable.roleIds })
    .from(botBumpSettingsTable)
    .where(eq(botBumpSettingsTable.guildId, message.guild.id))
    .limit(1);
  const roleIds = bumpSettings?.roleIds ?? [];
  await db.delete(botScheduledMessagesTable).where(and(
    eq(botScheduledMessagesTable.guildId, message.guild.id),
    eq(botScheduledMessagesTable.channelId, channelId),
    eq(botScheduledMessagesTable.kind, "bump"),
  ));
  const dueAt = new Date(Date.now() + BUMP_INTERVAL_MS);
  await db.insert(botScheduledMessagesTable).values({
    guildId: message.guild.id,
    userId: bumper?.id ?? message.author.id,
    channelId,
    kind: "bump",
    content: "Time to bump the server again! Use `/bump`.",
    dueAt,
  });
  if (!message.channel.isSendable()) return;
  const roleMentions = roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
  await message.channel.send({
    content: `${roleMentions ? `${roleMentions} ` : ""}Thanks for bumping! I'll remind you <t:${Math.floor(dueAt.getTime() / 1000)}:R>.`,
    allowedMentions: { parse: [], roles: roleIds },
  }).catch(() => undefined);
}

async function deliverDueMessages(client: Client): Promise<void> {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const dueMessages = await db.select()
      .from(botScheduledMessagesTable)
      .where(and(
        lte(botScheduledMessagesTable.dueAt, new Date()),
        eq(botScheduledMessagesTable.guildId, ACTIVE_BOT_GUILD_ID),
      ))
      .limit(100);

    for (const scheduled of dueMessages) {
      try {
        if (scheduled.kind === "reminder") {
          const user = await client.users.fetch(scheduled.userId);
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x57f287)
                .setTitle("Reminder")
                .setDescription(scheduled.content),
            ],
            allowedMentions: { parse: [] },
          });
        } else if (scheduled.kind === "bump") {
          const channel = await client.channels.fetch(scheduled.channelId).catch(() => null);
          if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) {
            const [bumpSettings] = await db.select({ roleIds: botBumpSettingsTable.roleIds })
              .from(botBumpSettingsTable)
              .where(eq(botBumpSettingsTable.guildId, scheduled.guildId))
              .limit(1);
            const roleIds = bumpSettings?.roleIds ?? [];
            const roleMentions = roleIds.map((roleId) => `<@&${roleId}>`).join(" ");
            await channel.send({
              content: `${roleMentions ? `${roleMentions} ` : ""}<@${scheduled.userId}> ${scheduled.content}`,
              allowedMentions: { users: [scheduled.userId], roles: roleIds },
            });
          }
        } else {
          const channel = await client.channels.fetch(scheduled.channelId).catch(() => null);
          if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) {
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x57f287)
                  .setTitle("Timer finished")
                  .setDescription(scheduled.content),
              ],
              allowedMentions: { parse: [] },
            });
          }
        }
      } catch (error) {
        logger.warn({ err: error, scheduledMessageId: scheduled.id, kind: scheduled.kind }, "Could not deliver scheduled message");
      } finally {
        await db.delete(botScheduledMessagesTable)
          .where(eq(botScheduledMessagesTable.id, scheduled.id));
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Scheduled message dispatch failed");
  } finally {
    schedulerRunning = false;
  }
}

export function startReminderScheduler(client: Client): void {
  if (scheduler) clearInterval(scheduler);
  scheduler = setInterval(() => {
    void deliverDueMessages(client);
  }, SCHEDULER_INTERVAL_MS);
  scheduler.unref();
  void deliverDueMessages(client);
}
