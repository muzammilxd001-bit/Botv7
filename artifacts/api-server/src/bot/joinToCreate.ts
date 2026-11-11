import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type Message,
  type ModalSubmitInteraction,
  type VoiceChannel,
  type VoiceState,
} from "discord.js";
import { eq } from "drizzle-orm";
import { db, botJoinToCreateTable, botJtcTempChannelsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { ACTIVE_BOT_GUILD_ID } from "./guildPolicy";
import { premiumColors } from "./presentation";

interface JtcConfig {
  lobbyId: string;
  categoryId: string | null;
  source: "guild" | "env";
}

const CONFIG_CACHE_MS = 15_000;
const configCache = new Map<string, { expiresAt: number; value: JtcConfig | null }>();

function envJtcConfig(): JtcConfig | null {
  const lobbyId = process.env["JTC_LOBBY_CHANNEL_ID"];
  if (!lobbyId) return null;
  return { lobbyId, categoryId: process.env["JTC_CATEGORY_ID"] || null, source: "env" };
}

// Per-guild config stored in the database, falling back to the JTC_* environment variables.
async function getJtcConfig(guildId: string): Promise<JtcConfig | null> {
  const cached = configCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const [row] = await db
      .select()
      .from(botJoinToCreateTable)
      .where(eq(botJoinToCreateTable.guildId, guildId))
      .limit(1);
    const value: JtcConfig | null = row
      ? { lobbyId: row.lobbyChannelId, categoryId: row.categoryId, source: "guild" }
      : envJtcConfig();
    configCache.set(guildId, { expiresAt: Date.now() + CONFIG_CACHE_MS, value });
    return value;
  } catch (err) {
    logger.error({ err, guildId }, "Failed to load join-to-create config");
    return envJtcConfig();
  }
}

async function setJtcConfig(guildId: string, lobbyId: string, categoryId: string | null): Promise<void> {
  await db
    .insert(botJoinToCreateTable)
    .values({ guildId, lobbyChannelId: lobbyId, categoryId })
    .onConflictDoUpdate({
      target: botJoinToCreateTable.guildId,
      set: { lobbyChannelId: lobbyId, categoryId, updatedAt: new Date() },
    });
  configCache.delete(guildId);
}

async function removeJtcConfig(guildId: string): Promise<boolean> {
  const deleted = await db
    .delete(botJoinToCreateTable)
    .where(eq(botJoinToCreateTable.guildId, guildId))
    .returning({ guildId: botJoinToCreateTable.guildId });
  configCache.delete(guildId);
  return deleted.length > 0;
}

// Cache persisted temporary-channel ownership for command interactions.
const tempChannels = new Map<string, string>();
const pendingChannelCleanup = new Map<string, NodeJS.Timeout>();
const channelCleanupInProgress = new Set<string>();

async function persistTempChannel(channelId: string, guildId: string, ownerId: string): Promise<void> {
  await db.insert(botJtcTempChannelsTable)
    .values({ channelId, guildId, ownerId })
    .onConflictDoUpdate({
      target: botJtcTempChannelsTable.channelId,
      set: { guildId, ownerId },
    });
  tempChannels.set(channelId, ownerId);
}

async function forgetTempChannel(channelId: string): Promise<void> {
  await db.delete(botJtcTempChannelsTable)
    .where(eq(botJtcTempChannelsTable.channelId, channelId));
  tempChannels.delete(channelId);
}

const JTC_PREFIX = "jtc:";
const RENAME_MODAL_ID = "jtc:rename_modal";
const TRANSFER_MODAL_ID = "jtc:transfer_modal";
const VOICE_COMMAND_MODAL_PREFIX = "jtc:command_modal:";
const RENAME_INPUT_ID = "name";
const TRANSFER_INPUT_ID = "owner";
const VOICE_COMMAND_INPUT_ID = "value";
const USER_LIMITS = [0, 2, 5, 10];
const OWNER_ONLY_MESSAGE = "Only the channel owner can use this.";
const BUMP_COOLDOWN_MS = 60 * 60 * 1000;
const lastBumpAt = new Map<string, number>();
const bannedMembersByChannel = new Map<string, Set<string>>();

function buildCommandPanel(): ActionRowBuilder<ButtonBuilder>[] {
  const commands = [
    ["info", "Info"],
    ["bump", "Bump"],
    ["lock", "Lock"],
    ["unlock", "Unlock"],
    ["size", "Size"],
    ["bitrate", "Bitrate"],
    ["rename", "Rename"],
    ["permit", "Permit"],
    ["unpermit", "Unpermit"],
    ["kick", "Kick"],
    ["pull", "Pull"],
    ["ban", "Ban"],
    ["unban", "Unban"],
    ["unbanall", "Unban all"],
    ["reset", "Reset"],
    ["claim", "Claim"],
    ["transfer", "Transfer"],
  ] as const;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < commands.length; index += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const [action, label] of commands.slice(index, index + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${JTC_PREFIX}${action}`)
          .setLabel(label)
          .setStyle(ButtonStyle.Secondary),
      );
    }
    rows.push(row);
  }
  return rows;
}

function buildWelcomePanel(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${JTC_PREFIX}commands`)
        .setLabel("Commands")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildCommandHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setTitle("Custom Voice Channel Commands")
    .setDescription(VC_HELP_TEXT);
}

async function transferOwnership(
  channel: VoiceChannel,
  newOwnerId: string,
  oldOwnerId: string,
): Promise<void> {
  await channel.permissionOverwrites.edit(newOwnerId, {
    ViewChannel: true,
    Connect: true,
    ManageChannels: null,
    MoveMembers: null,
  });
  if (oldOwnerId !== newOwnerId) {
    await channel.permissionOverwrites.edit(oldOwnerId, {
      ManageChannels: null,
      MoveMembers: null,
    });
  }
}

type AccessAction = "lock" | "unlock";

// Applies a lock/unlock change to the @everyone overwrite and returns the confirmation text.
async function applyAccessAction(
  channel: VoiceChannel,
  guild: Guild,
  action: AccessAction,
): Promise<string> {
  const everyone = guild.roles.everyone;
  switch (action) {
    case "lock":
      await channel.permissionOverwrites.edit(everyone, { Connect: false });
      return "🔒 Channel locked.";
    case "unlock":
      await channel.permissionOverwrites.edit(everyone, { Connect: true });
      return "🔓 Channel unlocked.";
  }
}

function isAccessAction(action: string): action is AccessAction {
  return action === "lock" || action === "unlock";
}

// Returns a user-facing reason the claim is not allowed, or null when the claim is valid.
function getClaimError(channel: VoiceChannel, userId: string): string | null {
  const ownerId = tempChannels.get(channel.id);
  if (ownerId === userId) return "You already own this channel.";
  if (!channel.members.has(userId)) return "You must be in the voice channel to claim it.";
  if (ownerId && channel.members.has(ownerId)) return "The channel owner is still in the channel.";
  return null;
}

async function performClaim(channel: VoiceChannel, userId: string): Promise<void> {
  const ownerId = tempChannels.get(channel.id);
  try {
    await transferOwnership(channel, userId, ownerId ?? userId);
    await persistTempChannel(channel.id, channel.guild.id, userId);
  } catch (err) {
    if (ownerId) {
      await transferOwnership(channel, ownerId, userId).catch(() => {});
      tempChannels.set(channel.id, ownerId);
    }
    throw err;
  }
}

// Members currently having a channel created for them, to avoid duplicates on rapid rejoins.
const pendingMembers = new Set<string>();

async function createTempChannel(
  client: Client,
  newState: VoiceState,
  config: JtcConfig,
): Promise<void> {
  const member = newState.member;
  const lobby = newState.channel;
  if (!member || !lobby) return;

  const pendingKey = `${newState.guild.id}:${member.id}`;
  if (pendingMembers.has(pendingKey)) return;
  pendingMembers.add(pendingKey);

  let created: VoiceChannel | null = null;
  try {
    const categoryId = config.categoryId || lobby.parentId || undefined;

created = await newState.guild.channels.create({
  name: `${member.displayName}'s Channel`,
  type: ChannelType.GuildVoice,
  parent: categoryId,
  permissionOverwrites: [
    {
      id: newState.guild.roles.everyone.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ],
    },
  ],
});
    await persistTempChannel(created.id, newState.guild.id, member.id);

    // The member may have left the lobby while the channel was being created.
    if (member.voice.channelId !== lobby.id) {
      await created.delete("Join to Create: member left before being moved");
      await forgetTempChannel(created.id);
      return;
    }

    await member.voice.setChannel(created, "Join to Create");
    logger.info(
      { guildId: newState.guild.id, userId: member.id, channelId: created.id },
      "Created join-to-create channel",
    );

    // A failure to post the panel must not tear down a channel the member is already in.
    const welcomeEmbed = new EmbedBuilder()
      .setColor(premiumColors.brand)
      .setTitle("Welcome to your channel")
      .setDescription(
        "Click **Commands** below to privately view the full command list and manage your channel.",
      )
      .setFooter({ text: "Your channel is ready." });
    await created.send({
      content: `<@${member.id}>`,
      embeds: [welcomeEmbed],
      components: buildWelcomePanel(),
      allowedMentions: { users: [member.id] },
    }).catch((sendErr) => {
      logger.error({ err: sendErr, channelId: created?.id }, "Failed to send join-to-create control panel");
    });
  } catch (err) {
    logger.error({ err, guildId: newState.guild.id, userId: member.id }, "Failed to create join-to-create channel");
    if (created) {
      await created.delete("Join to Create: failed to move member").then(() => {
        return forgetTempChannel(created!.id);
      }).catch((deleteErr) => {
        logger.error({ err: deleteErr, channelId: created?.id }, "Failed to clean up join-to-create channel");
      });
    }
  } finally {
    pendingMembers.delete(pendingKey);
  }
}

async function cleanupTempChannel(guild: Guild, channelId: string): Promise<void> {
  if (channelCleanupInProgress.has(channelId)) return;
  channelCleanupInProgress.add(channelId);

  try {
    let ownerId = tempChannels.get(channelId);
    if (!ownerId) {
      const [tracked] = await db.select({ ownerId: botJtcTempChannelsTable.ownerId })
        .from(botJtcTempChannelsTable)
        .where(eq(botJtcTempChannelsTable.channelId, channelId))
        .limit(1);
      ownerId = tracked?.ownerId;
      if (!ownerId) return;
      tempChannels.set(channelId, ownerId);
    }

    const channel = guild.channels.cache.get(channelId) ?? await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await forgetTempChannel(channelId);
      return;
    }

    const occupants = guild.voiceStates.cache.filter((state) => state.channelId === channelId);
    if (occupants.size > 0) {
      if (guild.voiceStates.cache.get(ownerId)?.channelId === channelId) return;

      const nextOwner = channel.members.find((member) => !member.user.bot);
      if (!nextOwner) return;
      const previousOwnerId = ownerId;
      await transferOwnership(channel, nextOwner.id, previousOwnerId);
      await persistTempChannel(channelId, guild.id, nextOwner.id);
      logger.info(
        { guildId: guild.id, channelId, ownerId: nextOwner.id },
        "Transferred join-to-create channel ownership",
      );
      await channel.send({ content: `👑 <@${nextOwner.id}> is now the owner of this channel.` }).catch(() => {});
      return;
    }

    await channel.delete("Join to Create: channel is empty");
    await forgetTempChannel(channelId);
    logger.info({ guildId: guild.id, channelId }, "Deleted empty join-to-create channel");
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId }, "Failed to clean up join-to-create channel; it will be retried");
    const priorTimer = pendingChannelCleanup.get(channelId);
    if (priorTimer) clearTimeout(priorTimer);
    const retryTimer = setTimeout(() => {
      pendingChannelCleanup.delete(channelId);
      void cleanupTempChannel(guild, channelId);
    }, 10_000);
    retryTimer.unref();
    pendingChannelCleanup.set(channelId, retryTimer);
  } finally {
    channelCleanupInProgress.delete(channelId);
  }
}

function scheduleTempChannelCleanup(guild: Guild, channelId: string, delayMs = 1_500): void {
  const priorTimer = pendingChannelCleanup.get(channelId);
  if (priorTimer) clearTimeout(priorTimer);

  const timer = setTimeout(() => {
    pendingChannelCleanup.delete(channelId);
    void cleanupTempChannel(guild, channelId);
  }, delayMs);
  timer.unref();
  pendingChannelCleanup.set(channelId, timer);
}

let tempChannelCleanupScheduler: NodeJS.Timeout | undefined;

export function startTempChannelCleanupScheduler(client: Client): void {
  if (tempChannelCleanupScheduler) return;
  tempChannelCleanupScheduler = setInterval(() => {
    void db.select({ guildId: botJtcTempChannelsTable.guildId, channelId: botJtcTempChannelsTable.channelId })
      .from(botJtcTempChannelsTable)
      .where(eq(botJtcTempChannelsTable.guildId, ACTIVE_BOT_GUILD_ID))
      .then(async (channels) => {
        for (const tracked of channels) {
          const guild = client.guilds.cache.get(tracked.guildId);
          if (guild) await cleanupTempChannel(guild, tracked.channelId);
        }
      })
      .catch((err) => logger.error({ err }, "Join to Create cleanup sweep failed"));
  }, 30_000);
  tempChannelCleanupScheduler.unref();
  void db.select({ guildId: botJtcTempChannelsTable.guildId, channelId: botJtcTempChannelsTable.channelId })
    .from(botJtcTempChannelsTable)
    .where(eq(botJtcTempChannelsTable.guildId, ACTIVE_BOT_GUILD_ID))
    .then(async (channels) => {
      for (const tracked of channels) {
        const guild = client.guilds.cache.get(tracked.guildId);
        if (guild) scheduleTempChannelCleanup(guild, tracked.channelId, 0);
      }
    })
    .catch((err) => logger.error({ err }, "Initial Join to Create cleanup sweep failed"));
}

function resolveTempChannel(interaction: ButtonInteraction | ModalSubmitInteraction): VoiceChannel | null {
  const channel = interaction.guild?.channels.cache.get(interaction.channelId ?? "");
  if (!channel || channel.type !== ChannelType.GuildVoice || !tempChannels.has(channel.id)) return null;
  return channel;
}

async function handleJtcButton(interaction: ButtonInteraction): Promise<void> {
  const action = interaction.customId.slice(JTC_PREFIX.length);
  const guild = interaction.guild;
  const channel = resolveTempChannel(interaction);
  if (!guild || !channel) {
    await interaction.reply({
      content: "This channel is no longer a temporary voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ownerId = tempChannels.get(channel.id);

  if (action === "commands") {
    await interaction.reply({
      embeds: [buildCommandHelpEmbed()],
      components: buildCommandPanel(),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === "claim") {
    if (interaction.user.bot) {
      await interaction.reply({ content: "Bot accounts cannot own temporary voice channels.", flags: MessageFlags.Ephemeral });
      return;
    }
    const claimError = getClaimError(channel, interaction.user.id);
    if (claimError) {
      await interaction.reply({ content: claimError, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await performClaim(channel, interaction.user.id);
    await interaction.editReply({ content: "You are now the owner of this channel." });
    return;
  }

  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  if (action === "rename") {
    const modal = new ModalBuilder().setCustomId(RENAME_MODAL_ID).setTitle("Rename Channel");
    const input = new TextInputBuilder()
      .setCustomId(RENAME_INPUT_ID)
      .setLabel("New channel name")
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(100)
      .setValue(channel.name.slice(0, 100))
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (action === "transfer") {
    const modal = new ModalBuilder().setCustomId(TRANSFER_MODAL_ID).setTitle("Transfer Channel Ownership");
    const input = new TextInputBuilder()
      .setCustomId(TRANSFER_INPUT_ID)
      .setLabel("Member name or @mention")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("@member or user id")
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  if (["size", "bitrate", "permit", "unpermit", "kick", "pull", "ban", "unban"].includes(action)) {
    const modal = new ModalBuilder()
      .setCustomId(`${VOICE_COMMAND_MODAL_PREFIX}${action}`)
      .setTitle(`${action[0]?.toUpperCase()}${action.slice(1)} Voice Channel`);
    const input = new TextInputBuilder()
      .setCustomId(VOICE_COMMAND_INPUT_ID)
      .setLabel(action === "size" || action === "bitrate" ? "Enter a number" : "Member mention or user ID")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    if (action === "size") input.setPlaceholder("0-99; 0 removes the limit");
    else if (action === "bitrate") input.setPlaceholder("8 kbps steps; server-tier maximum");
    else input.setPlaceholder("@member or user ID");
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (isAccessAction(action)) {
    await interaction.editReply({ content: await applyAccessAction(channel, guild, action) });
    return;
  }

  if (action === "info") {
    const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
    const embed = new EmbedBuilder()
      .setColor(premiumColors.brand)
      .setTitle("Voice Channel Settings")
      .addFields(
        { name: "Owner", value: `<@${ownerId}>`, inline: true },
        { name: "Members", value: String(channel.members.size), inline: true },
        { name: "Limit", value: channel.userLimit ? String(channel.userLimit) : "Unlimited", inline: true },
        { name: "Bitrate", value: `${Math.round(channel.bitrate / 1000)} kbps`, inline: true },
        { name: "Locked", value: overwrite?.deny.has(PermissionFlagsBits.Connect) ? "Yes" : "No", inline: true },
      );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  switch (action) {
    case "limit": {
      const index = USER_LIMITS.indexOf(channel.userLimit);
      const next = USER_LIMITS[(index + 1) % USER_LIMITS.length] ?? 0;
      await channel.setUserLimit(next);
      await interaction.editReply({
        content: next === 0 ? "👥 User limit removed." : `👥 User limit set to ${next}.`,
      });
      break;
    }
    case "bump": {
      if (!channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
        await interaction.editReply({ content: "This channel is not publicly visible, so it can't be bumped." });
        break;
      }
      const lastBump = lastBumpAt.get(channel.id) ?? 0;
      const remaining = BUMP_COOLDOWN_MS - (Date.now() - lastBump);
      if (remaining > 0) {
        await interaction.editReply({
          content: `This channel can be bumped again <t:${Math.ceil((Date.now() + remaining) / 1000)}:R>.`,
        });
        break;
      }
      await channel.setPosition(0, { reason: "Join to Create: channel bumped by owner" });
      lastBumpAt.set(channel.id, Date.now());
      await interaction.editReply({ content: "Your public channel has been bumped to the top of its category." });
      break;
    }
    case "reset": {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: true,
        Connect: true,
      });
      const memberOverwrites = channel.permissionOverwrites.cache.filter(
        (overwrite) => overwrite.type === 1 && overwrite.id !== ownerId,
      );
      for (const overwrite of memberOverwrites.values()) {
        await channel.permissionOverwrites.delete(overwrite.id);
      }
      await channel.setUserLimit(0);
      bannedMembersByChannel.delete(channel.id);
      lastBumpAt.delete(channel.id);
      await interaction.editReply({
        content: "Channel reset: it's public, unlocked, and has no member limit or extra access rules.",
      });
      break;
    }
    case "unbanall": {
      const bannedIds = bannedMembersByChannel.get(channel.id) ?? new Set<string>();
      for (const userId of bannedIds) {
        await channel.permissionOverwrites.delete(userId);
      }
      bannedMembersByChannel.delete(channel.id);
      await interaction.editReply({
        content: `Cleared ${bannedIds.size} channel ban${bannedIds.size === 1 ? "" : "s"}.`,
      });
      break;
    }
    default:
      await interaction.editReply({ content: "Unknown action." });
  }
}

async function handleJtcRenameSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const channel = resolveTempChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: "This channel is no longer a temporary voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (tempChannels.get(channel.id) !== interaction.user.id) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const name = interaction.fields.getTextInputValue(RENAME_INPUT_ID).trim().slice(0, 100);
  if (!name) {
    await interaction.reply({ content: "Channel name cannot be empty.", flags: MessageFlags.Ephemeral });
    return;
  }

  // Discord rate limits channel renames, so acknowledge first and edit once the rename completes.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await channel.setName(name, "Join to Create: renamed by owner");
  await interaction.editReply({ content: `✏️ Channel renamed to **${name}**.` });
}

export const VC_HELP_TEXT =
"**Custom voice channel controls**\n" +
"`!voice info` — view channel settings\n" +
"`!voice bump` — move your public channel to the top (1-hour cooldown)\n" +
"`!voice lock` / `!voice unlock` — control who can join\n" +
"`!voice name <name>` — rename the channel\n" +
"`!voice size <0-99>` — set member limit (0 removes it)\n" +
"`!voice bitrate <8-256>` — set bitrate up to the server's boost-tier maximum\n" +
"`!voice permit @user` / `!voice unpermit @user` — grant or clear member access\n" +
"`!voice kick @user` — disconnect a member\n" +
"`!voice pull @user` — pull a member from another voice channel\n" +
"`!voice ban @user` / `!voice unban @user` / `!voice unbanall` — manage channel bans\n" +
"`!voice reset` — restore public visibility, unlock, and remove the limit\n" +
"`!voice claim` — claim an abandoned channel\n" +
"`!voice transfer @user` — transfer ownership\n" +
"`!voice help` — show this command list\n\n" +
"Aliases: `!vc` and `!v`. `/voice help` is also available.";

const VC_USAGE =
"Usage: `!voice help` | `!voice <info|bump|lock|unlock|name|size|bitrate|permit|unpermit|kick|ban|unban|unbanall|reset|claim|transfer>`";

export async function handleVcCommand(message: Message, args: string[]): Promise<void> {
  const sub = args[0]?.toLowerCase() ?? "help";
  if (sub === "help" || sub === "usage") {
    await message.reply("For a private voice command list, use `/voice help`.");
    return;
  }

  const guild = message.guild;
  const voice = message.member?.voice.channel;
  if (!guild || !voice || voice.type !== ChannelType.GuildVoice || !tempChannels.has(voice.id)) {
    await message.reply("You must be in one of your temporary voice channels. Use `!voice help` to see commands.");
    return;
  }
  const channel: VoiceChannel = voice;

  const ownerId = tempChannels.get(channel.id);

  try {
    if (sub === "info") {
      const overwrite = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
      const locked = overwrite?.deny.has(PermissionFlagsBits.Connect) ?? false;
      const embed = new EmbedBuilder()
        .setTitle("Voice Channel Info")
        .addFields(
          { name: "Owner", value: ownerId ? `<@${ownerId}>` : "None", inline: true },
          { name: "Name", value: channel.name, inline: true },
          { name: "User Limit", value: channel.userLimit === 0 ? "None" : String(channel.userLimit), inline: true },
          { name: "Locked", value: locked ? "Yes" : "No", inline: true },
          { name: "Members", value: String(channel.members.size), inline: true },
        );
      await message.reply({ embeds: [embed] });
      return;
    }

    if (sub === "claim") {
      const claimError = getClaimError(channel, message.author.id);
      if (claimError) {
        await message.reply(claimError);
        return;
      }
      await performClaim(channel, message.author.id);
      await message.reply("You are now the owner of this channel.");
      return;
    }

    const normalizedSub = sub === "size" ? "limit" : sub === "rename" ? "name" : sub === "reject" ? "ban" : sub;
    const isOwnerCommand =
      isAccessAction(sub) ||
      [
        "limit", "size", "name", "rename", "bitrate", "bump", "reset",
        "transfer", "owner", "permit", "unpermit", "reject", "ban", "unban",
        "unbanall", "kick", "move", "pull",
      ].includes(sub);
    if (!isOwnerCommand) {
      await message.reply(VC_USAGE);
      return;
    }

    if (ownerId !== message.author.id) {
      await message.reply(OWNER_ONLY_MESSAGE);
      return;
    }

    if (isAccessAction(sub)) {
      await message.reply(await applyAccessAction(channel, guild, sub));
      return;
    }

    if (normalizedSub === "limit") {
      const raw = args[1] ?? "";
      const limit = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
        await message.reply("Provide a member limit between 0 and 99 (0 removes the limit).");
        return;
      }
      await channel.setUserLimit(limit);
      await message.reply(limit === 0 ? "Member limit removed." : `Member limit set to ${limit}.`);
      return;
    }

    if (normalizedSub === "name") {
      const name = args.slice(1).join(" ").trim().slice(0, 100);
      if (!name) {
        await message.reply("Provide a new channel name.");
        return;
      }
      await channel.setName(name, "Join to Create: renamed by owner");
      await message.reply(`✏️ Channel renamed to **${name}**.`);
      return;
    }

    if (sub === "bitrate") {
      const raw = args[1] ?? "";
      const bitrate = /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN;
      const maxBitrate = [64, 96, 128, 256][guild.premiumTier] ?? 64;
      if (!Number.isInteger(bitrate) || bitrate < 8 || bitrate > maxBitrate || bitrate % 8 !== 0) {
        await message.reply(`Choose a bitrate in 8 kbps steps from 8 to ${maxBitrate} kbps (your server's current maximum).`);
        return;
      }
      await channel.setBitrate(bitrate * 1000);
      await message.reply(`Voice bitrate set to **${bitrate} kbps**.`);
      return;
    }

    if (sub === "bump") {
      const lastBump = lastBumpAt.get(channel.id) ?? 0;
      const remaining = BUMP_COOLDOWN_MS - (Date.now() - lastBump);
      if (remaining > 0) {
        await message.reply(`This channel can be bumped again <t:${Math.ceil((Date.now() + remaining) / 1000)}:R>.`);
        return;
      }
      await channel.setPosition(0, { reason: "Join to Create: channel bumped by owner" });
      lastBumpAt.set(channel.id, Date.now());
      await message.reply("Your public channel has been bumped to the top of its category.");
      return;
    }

    if (sub === "reset") {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        ViewChannel: true,
        Connect: true,
      });
      const memberOverwrites = channel.permissionOverwrites.cache.filter(
        (overwrite) => overwrite.type === 1 && overwrite.id !== ownerId,
      );
      for (const overwrite of memberOverwrites.values()) {
        await channel.permissionOverwrites.delete(overwrite.id);
      }
      await channel.setUserLimit(0);
      bannedMembersByChannel.delete(channel.id);
      lastBumpAt.delete(channel.id);
      await message.reply("Channel reset: it's public, unlocked, and has no member limit or extra access rules.");
      return;
    }

    if (sub === "transfer" || sub === "owner") {
      const target = message.mentions.members?.first();
      if (!target) {
        await message.reply("Mention a member in this channel to transfer ownership, e.g. `!vc transfer @user`.");
        return;
      }
      if (target.id === ownerId) {
        await message.reply("You are already the owner of this channel.");
        return;
      }
      if (target.user.bot) {
        await message.reply("Bot accounts cannot own temporary voice channels.");
        return;
      }
      if (target.voice.channelId !== channel.id) {
        await message.reply("That member must be in this voice channel to become the new owner.");
        return;
      }
      await transferOwnership(channel, target.id, message.author.id);
      await persistTempChannel(channel.id, guild.id, target.id);
      await message.reply(`👑 Ownership transferred to <@${target.id}>.`);
      return;
    }

    if (sub === "unbanall") {
      const bannedIds = bannedMembersByChannel.get(channel.id) ?? new Set<string>();
      for (const userId of bannedIds) {
        await channel.permissionOverwrites.delete(userId).catch(() => null);
      }
      bannedMembersByChannel.delete(channel.id);
      await message.reply(`Cleared ${bannedIds.size} channel ban${bannedIds.size === 1 ? "" : "s"}.`);
      return;
    }

    // Remaining subcommands target a mentioned member or a user ID.
    const rawTargetId = args[1]?.replace(/^<@!?|>$/g, "");
    const target =
      message.mentions.members?.first() ??
      (rawTargetId ? await guild.members.fetch(rawTargetId).catch(() => null) : null);
    if (sub === "unban") {
      if (!rawTargetId) {
        await message.reply("Mention a member or provide their user ID to unban.");
        return;
      }
      await channel.permissionOverwrites.delete(rawTargetId);
      const bans = bannedMembersByChannel.get(channel.id);
      bans?.delete(rawTargetId);
      if (bans?.size === 0) bannedMembersByChannel.delete(channel.id);
      await message.reply(`Removed the channel ban for <@${rawTargetId}>.`);
      return;
    }

    if (!target) {
      await message.reply(`Mention a member, e.g. \`!voice ${sub} @user\`.`);
      return;
    }

    if (sub === "move" || sub === "pull") {
      if (target.voice.channelId === channel.id) {
        await message.reply("That member is already in your channel.");
        return;
      }
      if (!target.voice.channel) {
        await message.reply("That member is not in a voice channel.");
        return;
      }
      await target.voice.setChannel(channel, "Join to Create: pulled by owner");
      await message.reply(`Pulled <@${target.id}> into the channel.`);
      return;
    }

    if (target.id === ownerId) {
      await message.reply("You can't do that to the channel owner.");
      return;
    }

    if (sub === "permit") {
      await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
      await message.reply(`✅ Permitted <@${target.id}>.`);
    } else if (sub === "unpermit") {
      await channel.permissionOverwrites.delete(target.id).catch(() => null);
      await message.reply(`Removed the custom access rule for <@${target.id}>.`);
    } else if (normalizedSub === "ban") {
      await channel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false });
      if (target.voice.channelId === channel.id) {
        await target.voice.disconnect("Join to Create: banned by owner");
      }
      const bans = bannedMembersByChannel.get(channel.id) ?? new Set<string>();
      bans.add(target.id);
      bannedMembersByChannel.set(channel.id, bans);
      await message.reply(`⛔ Banned <@${target.id}> from the channel.`);
    } else if (sub === "kick") {
      if (target.voice.channelId !== channel.id) {
        await message.reply("That member is not in your channel.");
        return;
      }
      await target.voice.disconnect("Join to Create: kicked by owner");
      await message.reply(`🥾 Kicked <@${target.id}> from the channel.`);
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId: channel.id, sub }, "Failed to run !vc command");
    await message.reply("Something went wrong running that command.").catch(() => {});
  }
}

const JTC_USAGE =
  "ℹ️ Usage: `!jtc set <#lobby-voice-channel> [#category]`, `!jtc remove`, or `!jtc status`.";
const NO_MENTIONS = { parse: [] as never[], repliedUser: false };

function parseChannelId(token: string): string | null {
  const match = /^<#(\d{17,20})>$/.exec(token) ?? /^(\d{17,20})$/.exec(token);
  return match?.[1] ?? null;
}

export async function handleJtcCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;

  const reply = (content: string) =>
    message.reply({ content, allowedMentions: NO_MENTIONS });

  const member =
    message.member ?? (await guild.members.fetch(message.author.id).catch(() => null));
  if (
    !member?.permissions.has(PermissionFlagsBits.ManageGuild) &&
    !member?.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    await reply("❌ You need **Manage Server** permission to configure Join to Create.");
    return;
  }

  const sub = args[0]?.toLowerCase() ?? "";

  try {
    if (sub === "set") {
      const lobbyToken = args[1];
      if (!lobbyToken) {
        await reply("❌ Provide a lobby voice channel. " + JTC_USAGE);
        return;
      }
      const lobbyId = parseChannelId(lobbyToken);
      const lobby = lobbyId ? await guild.channels.fetch(lobbyId).catch(() => null) : null;
      if (!lobby || lobby.guildId !== guild.id) {
        await reply("❌ I couldn't find that channel in this server. Mention a voice channel from this server.");
        return;
      }
      if (lobby.type !== ChannelType.GuildVoice) {
        await reply("❌ The lobby must be a voice channel (not a stage, text channel, or category).");
        return;
      }

      let categoryId: string | null = null;
      if (args[2]) {
        const parsedCategoryId = parseChannelId(args[2]);
        const category = parsedCategoryId
          ? await guild.channels.fetch(parsedCategoryId).catch(() => null)
          : null;
        if (!category || category.guildId !== guild.id) {
          await reply("❌ I couldn't find that category in this server.");
          return;
        }
        if (category.type !== ChannelType.GuildCategory) {
          await reply("❌ The category must be a channel category.");
          return;
        }
        categoryId = category.id;
      }

      await setJtcConfig(guild.id, lobby.id, categoryId);
      await reply(
        `✅ Join to Create is on. Members who join <#${lobby.id}> get their own voice channel` +
          (categoryId ? ` in <#${categoryId}>.` : " in the lobby's category."),
      );
      return;
    }

    if (sub === "remove" || sub === "disable") {
      const removed = await removeJtcConfig(guild.id);
      const env = envJtcConfig();
      const envActive = env !== null && guild.channels.cache.has(env.lobbyId);
      if (envActive) {
        await reply(
          `${removed ? "✅ Server settings removed." : "ℹ️ No server settings were saved."} ` +
            `Join to Create is still active through the bot's default lobby <#${env.lobbyId}>.`,
        );
      } else {
        await reply(
          removed ? "✅ Join to Create is now off." : "ℹ️ Join to Create was not configured.",
        );
      }
      return;
    }

    if (sub === "status") {
      const config = await getJtcConfig(guild.id);
      if (!config || (config.source === "env" && !guild.channels.cache.has(config.lobbyId))) {
        await reply("ℹ️ Join to Create is off. Use `!jtc set <#lobby> [#category]` to turn it on.");
        return;
      }
      await reply(
        [
          "✨ Join to Create is on.",
          `Lobby: <#${config.lobbyId}>`,
          `Category: ${config.categoryId ? `<#${config.categoryId}>` : "same as the lobby"}`,
          config.source === "env" ? "Source: bot default (environment)" : "Source: server settings",
        ].join("\n"),
      );
      return;
    }

    await reply(JTC_USAGE);
  } catch (err) {
    logger.error({ err, guildId: guild.id, sub }, "Failed to run !jtc command");
    await reply("❌ Something went wrong running that command. Please try again.").catch(() => {});
  }
}

export async function handleJtcInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction,
): Promise<void> {
  if (!interaction.customId.startsWith(JTC_PREFIX)) return;

  if (interaction.isButton()) {
    await handleJtcButton(interaction);
  } else if (interaction.isModalSubmit() && interaction.customId === RENAME_MODAL_ID) {
    await handleJtcRenameSubmit(interaction);
  } else if (interaction.isModalSubmit() && interaction.customId === TRANSFER_MODAL_ID) {
    await handleJtcTransferSubmit(interaction);
  } else if (interaction.isModalSubmit() && interaction.customId.startsWith(VOICE_COMMAND_MODAL_PREFIX)) {
    await handleVoiceCommandModal(interaction);
  }
}

async function handleVoiceCommandModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild;
  const channel = resolveTempChannel(interaction);
  const action = interaction.customId.slice(VOICE_COMMAND_MODAL_PREFIX.length);
  if (!guild || !channel) {
    await interaction.reply({ content: "This channel is no longer a temporary voice channel.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (tempChannels.get(channel.id) !== interaction.user.id) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const value = interaction.fields.getTextInputValue(VOICE_COMMAND_INPUT_ID).trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (action === "size" || action === "bitrate") {
    const amount = /^\d+$/.test(value) ? Number.parseInt(value, 10) : Number.NaN;
    if (action === "size") {
      if (!Number.isInteger(amount) || amount < 0 || amount > 99) {
        await interaction.editReply("Enter a member limit from 0 to 99 (0 removes it).");
        return;
      }
      await channel.setUserLimit(amount);
      await interaction.editReply(amount === 0 ? "Member limit removed." : `Member limit set to ${amount}.`);
      return;
    }

    const maxBitrate = [64, 96, 128, 256][guild.premiumTier] ?? 64;
    if (!Number.isInteger(amount) || amount < 8 || amount > maxBitrate || amount % 8 !== 0) {
      await interaction.editReply(`Choose a bitrate in 8 kbps steps from 8 to ${maxBitrate} kbps.`);
      return;
    }
    await channel.setBitrate(amount * 1000);
    await interaction.editReply(`Voice bitrate set to **${amount} kbps**.`);
    return;
  }

  const targetId = value.replace(/^<@!?|>$/g, "");
  if (!/^\d{17,20}$/.test(targetId)) {
    await interaction.editReply("Enter a valid member mention or user ID.");
    return;
  }
  if (action === "unban") {
    await channel.permissionOverwrites.delete(targetId);
    const bans = bannedMembersByChannel.get(channel.id);
    bans?.delete(targetId);
    if (bans?.size === 0) bannedMembersByChannel.delete(channel.id);
    await interaction.editReply(`Removed the channel ban for <@${targetId}>.`);
    return;
  }

  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    await interaction.editReply("I couldn't find that member in this server.");
    return;
  }
  if (target.id === interaction.user.id) {
    await interaction.editReply("You can't use this action on yourself.");
    return;
  }

  switch (action) {
    case "permit":
      await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, Connect: true });
      await interaction.editReply(`Permitted <@${target.id}>.`);
      return;
    case "unpermit":
      await channel.permissionOverwrites.delete(target.id).catch(() => null);
      await interaction.editReply(`Removed the custom access rule for <@${target.id}>.`);
      return;
    case "kick":
    case "ban":
      if (target.voice.channelId === channel.id) {
        await target.voice.disconnect(`Join to Create: ${action === "ban" ? "banned" : "kicked"} by owner`);
      } else if (action === "kick") {
        await interaction.editReply("That member is not in this voice channel.");
        return;
      }
      if (action === "ban") {
        await channel.permissionOverwrites.edit(target.id, { Connect: false, ViewChannel: false });
        const bans = bannedMembersByChannel.get(channel.id) ?? new Set<string>();
        bans.add(target.id);
        bannedMembersByChannel.set(channel.id, bans);
        await interaction.editReply(`Banned <@${target.id}> from this channel.`);
      } else {
        await interaction.editReply(`Kicked <@${target.id}> from this channel.`);
      }
      return;
    case "pull":
      if (!target.voice.channel) {
        await interaction.editReply("That member is not connected to a voice channel.");
        return;
      }
      await target.voice.setChannel(channel, "Join to Create: pulled by owner");
      await interaction.editReply(`Pulled <@${target.id}> into this channel.`);
      return;
    default:
      await interaction.editReply("Unknown voice-channel command.");
  }
}

async function handleJtcTransferSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const channel = resolveTempChannel(interaction);
  if (!channel) {
    await interaction.reply({
      content: "This channel is no longer a temporary voice channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (tempChannels.get(channel.id) !== interaction.user.id) {
    await interaction.reply({ content: OWNER_ONLY_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const raw = interaction.fields.getTextInputValue(TRANSFER_INPUT_ID).trim();
  const targetMember = raw
    ? (interaction.guild?.members.cache.get(raw.replace(/^<@!?|>$/g, "")) ??
        interaction.guild?.members.cache.find((member) => member.user.username.toLowerCase() === raw.toLowerCase() || member.user.tag.toLowerCase() === raw.toLowerCase()) ??
        null)
    : null;

  if (!targetMember) {
    await interaction.reply({
      content: "Mention a valid member in this channel or enter their user ID.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetMember.id === interaction.user.id) {
    await interaction.reply({
      content: "You are already the owner of this channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetMember.user.bot) {
    await interaction.reply({
      content: "Bot accounts cannot own temporary voice channels.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (targetMember.voice.channelId !== channel.id) {
    await interaction.reply({
      content: "That member must be in this voice channel to become the new owner.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await transferOwnership(channel, targetMember.id, interaction.user.id);
  await persistTempChannel(channel.id, channel.guild.id, targetMember.id);
  await interaction.editReply({ content: `👑 Ownership transferred to <@${targetMember.id}>.` });
}

export async function handleVoiceStateUpdate(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const member = newState.member ?? oldState.member;
  if (!member) return;

  if (oldState.channelId === newState.channelId) return;

  // Guild config (set with !jtc) takes priority; env vars are the fallback.
  if (newState.channelId && !member.user.bot && member.id !== client.user?.id) {
    const config = await getJtcConfig(newState.guild.id);
    if (config && newState.channelId === config.lobbyId) {
      await createTempChannel(client, newState, config);
    }
  }

  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    scheduleTempChannelCleanup(oldState.guild, oldState.channelId);
  }
}
