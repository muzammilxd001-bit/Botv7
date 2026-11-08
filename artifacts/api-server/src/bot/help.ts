import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  type Message,
} from "discord.js";
import { SOCIAL_ACTIONS, type SocialActionName } from "./social";
import { premiumColors, premiumEmbed } from "./presentation";

const C = premiumColors.brand;
const TIMEOUT = 5 * 60_000;
const HELP_FOOTER = "Choose a category or browse with Previous/Next";
const CATEGORIES = [
  { label: "🏠 Bot Overview", value: "home", description: "Main bot modules and quick start" },
  { label: "🧭 Start & Giveaways", value: "start", description: "Help and giveaway commands" },
  { label: "🛡️ Moderation", value: "moderation", description: "Warnings, timeouts, kicks, and bans" },
  { label: "⚙️ Server Controls", value: "controls", description: "Roles, channels, and announcements" },
  { label: "📡 Automation", value: "automation", description: "Auto-reactions, sticky, and welcome" },
  { label: "🧰 Server & Utility", value: "utility", description: "Server info, members, and bot tools" },
  { label: "🎮 Games", value: "games", description: "Word Bomb and game commands" },
  { label: "💰 Economy", value: "economy", description: "Browse and buy server roles" },
  { label: "💛 Social: Friendly", value: "friendly", description: "Hugs, cheers, compliments, and more" },
  { label: "💞 Social: Affection", value: "affection", description: "Cute and affectionate reactions" },
  { label: "✨ Social: Reactions", value: "reactions", description: "Anime reactions and playful actions" },
  { label: "📊 Scores & Ships", value: "scores", description: "Aura, rizz, ratings, and ship checks" },
] as const;
type CategoryId = (typeof CATEGORIES)[number]["value"];
const CATEGORY_ALIASES: Record<string, CategoryId> = {
  home: "home",
  start: "start",
  giveaway: "start",
  giveaways: "start",
  moderation: "moderation",
  mod: "moderation",
  controls: "controls",
  server: "controls",
  automation: "automation",
  utility: "utility",
  utilities: "utility",
  games: "games",
  game: "games",
  economy: "economy",
  credits: "economy",
  friendly: "friendly",
  affection: "affection",
  reactions: "reactions",
  scores: "scores",
};

function helpPage(title: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(C)
    .setAuthor({ name: "MAINZ  •  COMMAND CENTER" })
    .setTitle(title)
    .setFooter({ text: HELP_FOOTER })
    .setTimestamp();
}

function pageHome(): EmbedBuilder {
  return helpPage("🏠 Bot Overview")
    .setDescription("A complete command center for your server, community, and games.")
    .addFields(
      {
        name: "🛡️ Safety & Moderation",
        value: "Warnings, timeouts, bans, AutoMod, and channel controls.",
        inline: true,
      },
      {
        name: "⚙️ Server Setup",
        value: "Roles, tickets, voice channels, and server configuration.",
        inline: true,
      },
      {
        name: "📡 Automation",
        value: "Welcome messages, sticky posts, and automatic reactions.",
        inline: true,
      },
      {
        name: "🎉 Giveaways & Economy",
        value: "Giveaways, credits, hourly work, drops, and role shop.",
        inline: true,
      },
      {
        name: "🎮 Games & Social",
        value: "Word Bomb, social actions, daily scores, and ships.",
        inline: true,
      },
      {
        name: "🧰 Utilities",
        value: "Member, server, channel, and bot information.",
        inline: true,
      },
      {
        name: "🚀 Quick Start",
        value: "Use `!command` or `/command`. Pick a category below or browse page by page.",
      },
    );
}

function page1(): EmbedBuilder {
  return helpPage("🧭 Start & Giveaways")
    .setDescription("Your command hub. Prefix and slash commands do the same thing.")
    .addFields(
      { name: "`!help <category>`", value: "Open detailed help privately, for example `!help games` or `!help moderation`." },
      { name: "`!gstart <duration> [winners] <prize>` • `/gstart`", value: "Start a giveaway. **Example:** `!gstart 1d 2 Nitro`\n**Durations:** `30s` `5m` `2h` `1d`\n*(Manage Server)*" },
      { name: "`!gend <message_id>` • `/gend`", value: "End a running giveaway early.\n*(Manage Server)*" },
      { name: "`!greroll <message_id> [amount]` • `/greroll`", value: "Reroll one or more winners from an ended giveaway.\n*(Manage Server)*" },
      { name: "`!afk [status]` • `/afk`", value: "Set your AFK status. Send any message to remove it." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page2(): EmbedBuilder {
  return helpPage("🛡️ Moderation")
    .addFields(
      { name: "`!modrole set @role` • `/modrole set`", value: "Choose the role allowed to use `!warn`, `!clearwarn`, `!mute`, and `!unmute`. Check with `status`; clear with `remove`. *(Manage Server)*" },
      { name: "`!warn @user <reason>` • `/warn`", value: "Warn a member and DM the reason. Requires the configured moderation role." },
      { name: "`!warnings @user` • `/warnings`", value: "View a member's warnings.\n*(Manage Server)*" },
      { name: "`!clearwarn` / `!clearwarnings @user` • `/clearwarnings`", value: "Clear all warnings for a member. Requires the configured moderation role." },
      { name: "`!mute @user <duration> [reason]` • `/mute`", value: "Timeout a member. `30s` `5m` `2h` `1d`, max 28 days. Requires the configured moderation role." },
      { name: "`!unmute @user` • `/unmute`", value: "Remove a member timeout. Requires the configured moderation role." },
      { name: "`!kick @user [reason]` • `/kick`", value: "Kick a member.\n*(Kick Members)*" },
      { name: "`!ban @user|<user_id> [reason]` • `/ban`", value: "Ban a server member by mention or Discord user ID; delete their messages from the past 7 days.\n*(Ban Members)*" },
      { name: "`!modlimit set @user kick <count> ban <count>`", value: "Set cumulative kick/ban limits for a moderator. Check with `!modlimit status @user`, reset usage with `!modlimit reset @user [kick|ban]`, or remove limits with `!modlimit remove @user`. *(Manage Server)*" },
      { name: "`!unban <user_id>` • `/unban`", value: "Unban a user by ID.\n*(Ban Members)*" },
      { name: "`!nuke` • `/nuke`", value: "Clone the channel and delete the old one. Confirmation required.\n*(Manage Channels)*" },
      { name: "`!slowmode <seconds>` • `/slowmode`", value: "Set slowmode from 0 to 21600 seconds.\n*(Manage Channels)*" },
      { name: "`!lock` • `/lock`", value: "Lock the current channel.\n*(Manage Channels)*" },
      { name: "`!unlock` • `/unlock`", value: "Unlock the current channel.\n*(Manage Channels)*" },
      { name: "`!hide [#channel]` / `!unhide [#channel]`", value: "Hide a channel from @everyone or make it visible again. Use `!unhide #channel` from another channel if hiding it removes your access.\n*(Manage Channels)*" },
      { name: "`!purge <amount>` • `/purge`", value: "Delete 1–100 recent messages.\n*(Manage Messages)*" },
      { name: "`!pb [amount]` • `/pb`", value: "Delete recent bot messages.\n*(Manage Messages)*" },
      { name: "`!automod status`", value: "View filters and domain lists. Link filtering starts **Off**; enable or disable it with `!automod set links on|off`. Add/remove words with `!automod add|remove <word>`, and domains with `!automod blocklink|unblocklink <domain>` or `!automod allowlink|unallowlink <domain>`. Allowed domains bypass the global link filter; blocked domains are always blocked.\n*(Manage Server)*" },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page3(): EmbedBuilder {
  return helpPage("⚙️ Server Controls")
    .addFields(
      { name: "`!noprefix @role` • `/noprefix`", value: "Let a role use commands without `!`; use `remove` to disable it.\n*(Manage Server)*" },
      { name: "`!socialrole set @role1 @role2...` • `/socialrole set`", value: "Require any one of several server roles to use social actions like `!kiss` and `!hug`. Check `status` or clear with `remove|clear|off`.\n*(Manage Server)*" },
      { name: "`!role @user @role|Role Name` • `/role`", value: "Add or remove a role using its mention or exact name (including spaces).\n*(Manage Roles)*" },
      { name: "`!nick @user <name|reset>` • `/nick`", value: "Change or reset a member nickname.\n*(Manage Nicknames)*" },
      { name: "`!announce #channel <message>` • `/announce` • `/send`", value: "Send an announcement embed to a channel.\n*(Manage Server)*" },
      { name: "`!embed`", value: "Create named embeds with title, description, hex color, images, thumbnails, footer and fields; preview with `show` and post with `send`. Customize command-response embeds separately with `!embed override`; reset with `override-reset`.\n*(Manage Server)*" },
      { name: "`!voice help` • `!v help` • `/voice help`", value: "Manage your Join to Create channel: `info` `bump` `lock` `unlock` `name <name>` `size <n>` `bitrate <kbps>` `permit|unpermit @user` `kick|ban|unban @user` `unbanall` `reset` `claim` `transfer @user`. `!vc` remains an alias. Channel controls are owner-only; `info`, `claim`, and help are available to everyone." },
      { name: "`!jtc set #lobby [#category]` • `/jtc set`", value: "Choose the Join to Create lobby voice channel and optional category.\n*(Manage Server)*" },
      { name: "`!jtc remove|disable` • `!jtc status` • `/jtc`", value: "Turn off Join to Create, or show the configured lobby and category.\n*(Manage Server)*" },
      { name: "`!ticket panel` • `!ticket new|open`", value: "Post a Support Tickets panel. Members click **Open Ticket** to create a private support channel." },
      { name: "`!ticket close [reason]`", value: "Close your ticket; staff can close any ticket." },
      { name: "`!ticket setup|set|config #category` • `!ticket status`", value: "Configure or inspect the ticket category.\n*(Manage Server for setup)*" },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page4(): EmbedBuilder {
  return helpPage("🧰 Server & Utility")
    .addFields(
      { name: "`!userinfo [@user]` • `/userinfo`", value: "View member ID, roles, account age, and join date." },
      { name: "`!roleinfo @role`", value: "View a role's ID, member count, position, and permissions." },
      { name: "`!serverinfo` • `/serverinfo`", value: "View server owner, members, channels, roles, and boosts." },
      { name: "`!mc` / `!membercount` • `/mc`", value: "Show total, humans, bots, online, idle, DND, active, and offline counts." },
      { name: "`!ping` • `/ping`", value: "Show bot WebSocket latency and uptime." },
      { name: "`!botinfo` • `/botinfo`", value: "Show bot tag, server count, latency, and uptime." },
      { name: "`!channelinfo` • `/channelinfo`", value: "Show current channel ID, type, category, and creation time." },
      { name: "`!avatar [@user]` • `/avatar`", value: "Show a member's avatar in high resolution." },
      { name: "`!banner [user @user|server]`", value: "Show your own banner, another user's banner, or the server banner." },
      { name: "`!snipe`", value: "Show the most recently deleted message in this channel." },
      { name: "`!reminder start <duration> <text>` / `!reminder clear`", value: "DM yourself a reminder later, or cancel all your pending reminders. Durations: `30s`, `5m`, `2h`, up to `7d`." },
      { name: "`!timer <duration> [message]`", value: "Post a timer completion in this channel. Durations: `30s`, `5m`, `2h`, up to `7d`." },
      { name: "`!bump roles @role1 @role2` • `!bump status` • `!bump remove`", value: "Configure which server roles are mentioned in automatic bump reminders. *(Manage Server)*" },
      { name: "`!quote <text>` • `/quote`", value: "Create a clean black quote card with your avatar, display name, and username." },
      { name: "`!setquote #channel` • `/setquote channel`", value: "Restrict quote cards to one text channel. Check with `status` or clear with `remove`. *(Manage Server)*" },
      { name: "`!quoterole set @role1 @role2`", value: "Require members to have any one of up to 10 roles to create quote cards. *(Manage Server)*" },
      { name: "`!quoterole status` / `!quoterole remove`", value: "Show or remove the quote-role requirement. *(Manage Server)*" },
      { name: "`!steal` (reply to an emoji or sticker)", value: "Choose to add an emoji or PNG/APNG/GIF sticker from the replied-to message as a server emoji or sticker. Lottie stickers are converted to a still image. Requires **Create Expressions** permission and an available slot." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function pageAutomation(): EmbedBuilder {
  return helpPage("📡 Automation")
    .setDescription("Configure these features with **Manage Server** permission.")
    .addFields(
      { name: "`!autoresponder set #channel trigger => response`", value: "Automatically reply when a message contains the trigger as a whole word or phrase. Check with `status`; turn off with `remove`. *(Manage Server)*" },
      { name: "`!autoreact set #channel <emoji> [trigger text]` • `/autoreact set`", value: "With no trigger text, react to every user message. Add a phrase to react only when a user or bot message contains it, e.g. `!autoreact set #chat 🎉 \"leveled up\"`. Matching ignores letter case." },
      { name: "`!autoreact status #channel` • `/autoreact status`", value: "Show the active reaction for a channel." },
      { name: "`!autoreact remove #channel` • `/autoreact remove`", value: "Turn off auto-react for a channel." },
      { name: "`!statusrole set @role #logs <trigger1> | <trigger2>`", value: "Give members a role while their custom status contains any configured trigger, then remove it when no trigger matches. Separate up to 10 triggers with `|`. *(Manage Server)*" },
      { name: "`!statusrole message <title> | <description>`", value: "Set the log embed title and description. Placeholders: `{{user}}`, `{{role}}`, and `{{trigger}}`. *(Manage Server)*" },
      { name: "`!statusrole message reset`", value: "Restore the default status-role log embed. *(Manage Server)*" },
      { name: "`!statusrole status`", value: "Show the configured role, triggers, and log channel. *(Manage Server)*" },
      { name: "`!statusrole remove`", value: "Disable status-role automation. *(Manage Server)*" },
      { name: "`!guildtagrole set @role #logs`", value: "Give members this role when they enable this server's guild tag. The configured channel logs when the role is added or removed. *(Manage Server)*" },
      { name: "`!guildtagrole message <title> | <description>`", value: "Customize add/remove log embeds. Placeholders: `{{user}}`, `{{role}}`, `{{tag}}`, `{{action}}`, `{{actionLower}}`, and `{{roleAction}}`. *(Manage Server)*" },
      { name: "`!guildtagrole message reset`", value: "Restore the default guild-tag log message. *(Manage Server)*" },
      { name: "`!guildtagrole status`", value: "Show the guild-tag role and log channel. *(Manage Server)*" },
      { name: "`!guildtagrole remove`", value: "Disable guild-tag role automation. *(Manage Server)*" },
        { name: "`!auto emergency enable|disable|status`", value: "Monitor per-actor thresholds of 40 bans, 40 kicks, or 40 @everyone/@here pings within 10 minutes. On threshold, remove the executor's assignable roles and save permission snapshots. Configure with Manage Server; only the server owner can restore with `!auto emergency restore`. Requires View Audit Log and Manage Roles. Undefined unusual activity is not monitored." },
        { name: "`!auto emergency restore`", value: "Owner-only: restore quarantined member roles and role permissions saved during emergency mode." },
      { name: "`!sticky set #channel <embed|plain> <message>` • `/sticky set`", value: "Keep one message at the bottom of a channel. Choose an embed or plain message; it moves after new messages." },
      { name: "`!sticky status #channel`", value: "Check whether a sticky message is configured in a channel." },
      { name: "`!sticky remove #channel` • `/sticky remove`", value: "Remove the sticky message and stop reposting it." },
      { name: "`!welcome test` • `!boost test`", value: "Send the configured welcome or boost message to its channel using you as the member." },
      { name: "`!set boost channel #channel <message or {embed:name}>` • `!boost set #channel <message>` • `!boost embed #channel [name]`", value: "Post a message when someone boosts the server. Placeholders: `{user}`, `{user_tag}` (nickname), `{server}`, `{memberCount}`, `{boostCount}`. Link a saved embed with `{embed:name}`. Remove with `!boost remove`." },
      { name: "`!welcome set #channel <message>` • `/welcome set`", value: "Post a branded text welcome. Use `{user}`, `{user_tag}` (nickname), `{server}`, or `{memberCount}`. Add `{embed:name}` to include a saved embed with the greeting, e.g. `!welcome set #welcome Welcome {user}! {embed:welcome}`." },
      { name: "`!welcome embed #channel [name]`", value: "Use a saved custom embed by itself when a member joins. Create/edit it with `!embed create`, `!embed edit`, and preview with `!embed show`. The default embed name is `welcome`; placeholders are supported." },
      { name: "`!welcome remove` • `/welcome remove`", value: "Turn off welcome messages." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function page5(): EmbedBuilder {
  return helpPage("🎮 Games")
    .addFields(
      { name: "💣 **Word Bomb**", value: "\u200b" },
      { name: "`!setgame #channel` • `/setgame channel`", value: "Set the one channel where Word Bomb and credit games can be played. *(Manage Server)*" },
      { name: "`!wordbomb` / `!wb` • `/wordbomb`", value: "Start a Word Bomb game in the configured games channel. React ✅ to join. **10s** per turn, **3 lives** each. Real English words only!" },
      { name: "`!wbstop` / `!wordbomb stop` • `/wbstop`", value: "Stop the current Word Bomb game in the configured games channel. *(Manage Server)*" },
      { name: "`!wbtop` • `/wbtop`", value: "Show the Word Bomb win leaderboard in the configured games channel." },
      { name: "💰 **Credit Games**", value: "Configure each game separately: `!games trivia setup #channel 30m 100`, `!games math setup #channel 1m 100`, `!games number setup #channel 1m 100`, then use `status`, `pause`, `resume`, or `remove` with that game name. Math and number rounds run on a 1-minute cooldown and stay open for 1 minute. The first correct answer in every game wins the same default 100 credits; `/games args` supports the same syntax.\n\n**Gambling:** `!coinflip heads 100`, `!cf 200 h`, `!cf 200` for a random side, `!cf all` to bet your full balance, or `!gamble coinflip tails 100`; `/coinflip` is also available. Bets are 1–250,000 credits and a win pays 1:1. Responses use plain Owo-style text, not embeds." },
      { name: "✅ **Command notes**", value: "Slash commands appear server-by-server after the bot starts. Prefix commands continue to work as before.\n\nFor accurate online/offline presence counts, enable **Server Members Intent** and **Presence Intent** in the Discord Developer Portal." },
      { name: "💳 **Credits**", value: "Check your balance with `!credit`, `!credits`, or `!cash`. Use `!daily` for a 7-day streak reward: **100, 150, 200, 250, 300, 400, then 500 credits**. Earn **20 credits** from chat once per minute, **10–100 credits** in a reaction drop, or different random rewards for two active chatters every 30 minutes (21+ messages each in the last 10 minutes): **Common 50**, **Rare 100**, or very rare **Epic 200 credits**. Set their announcement channel with `!setchatreward #channel` or `/setchatreward`; check with `status`, or clear with `remove`. Spend credits on server roles with `!shop` and `!shop buy @role`." },
      { name: "🦉 **Credit drops**", value: "A random rarity drop appears on each configured channel. The first correct reaction wins **Common: 100–200**, **Rare: 200–500**, or **Epic: 500–1,000 credits**. Server managers can repeat `!creditdrop setup #channel [30m]` for multiple channels; remove one with `!creditdrop remove #channel`. Set an interval for all channels with `!creditdrop interval 1h` or one channel with `!creditdrop interval 1h #channel` (0m–24h). Check with `!creditdrop status`; pause or resume all channels, or one selected channel, with `!creditdrop pause [#channel]` / `resume [#channel]`." },
    )
    .setFooter({ text: HELP_FOOTER });
}

function pageEconomy(): EmbedBuilder {
  return helpPage("💰 Economy")
    .addFields(
      { name: "💳 **Credits**", value: "`!credit` / `!credits` / `!cash` — check your balance\n`!daily` — claim a streak reward\n`!rob @user` — 50% chance to rob 100–1,000 credits; failed attempts cost 100 credits. Targets need at least 50,000 credits and robbing has a 15-second cooldown.\n`!transfer @user <amount>` or `!give @user <amount>` — send your credits to another server member\n`!top credits` — browse the credits leaderboard with Next/Previous buttons\n`!credits add @user <amount>` / `give` / `remove` — adjust a member's balance (**Manage Server**).\nTwo chatters with 21+ messages each in 10 minutes receive different tiers: **Common 50**, **Rare 100**, or very rare **Epic 200 credits**." },
      { name: "🗺️ **Flag drops**", value: "Guess the country shown in the flag image; the first correct answer wins a random credit-drop tier: **Common 100–200**, **Rare 200–500**, or **Epic 500–1,000 credits**. Server managers can set up multiple channels with `!flagdrop setup #channel [15m]`; intervals are 0m–24h. Use `!flagdrop status`, `!flagdrop interval 1h [#channel]`, `!flagdrop pause [#channel]`, `!flagdrop resume [#channel]`, or `!flagdrop remove #channel`." },
      { name: "🏷️ **Role shop**", value: "`!shop` — browse numbered role/price pages\n`!shop buy @role` or `!shop buy Role Name` — buy with credits\n`!shop role @role` — buy a listed role\n`!shop add @role <price>` — add a listing\n`!shop edit @role <new-price>` — edit its price\n`!shop remove @role` — remove a listing (**Manage Server**)" },
    )
    .setFooter({ text: HELP_FOOTER });
}

const FRIENDLY_ACTIONS: SocialActionName[] = [
  "hug",
  "highfive",
  "wave",
  "smile",
  "cheer",
  "thanks",
  "comfort",
  "celebrate",
  "compliment",
];
const AFFECTION_ACTIONS: SocialActionName[] = [
  "kiss",
  "bite",
  "pat",
  "cuddle",
  "boop",
  "handhold",
  "blush",
  "feed",
  "nom",
  "pout",
];
const REACTION_ACTIONS: SocialActionName[] = [
  "kill",
  "fight",
  "slap",
  "poke",
  "bonk",
  "dance",
  "punch",
  "cry",
  "roast",
  "cartoonkick",
  "laugh",
  "shrug",
  "think",
  "wink",
  "clap",
];

function socialCategory(
  title: string,
  actionNames: SocialActionName[],
  includeShip = false,
): EmbedBuilder {
  const fields = actionNames.map((name) => ({
    name: `\`!${name} @user\` • \`/${name} user\``,
    value: SOCIAL_ACTIONS[name].help,
  }));
  if (includeShip) {
    fields.push({
      name: "`!ship @user1 @user2` • `/ship user1 user2`",
      value: "Get a playful compatibility score for two members. No one gets pinged.",
    });
  }

  return new EmbedBuilder()
    .setColor(C)
    .setAuthor({ name: "MAINZ  •  COMMAND CENTER" })
    .setTitle(`📖 Help • ${title}`)
    .setDescription("Prefix and slash commands do the same thing. Social commands can be role-restricted with `!socialrole set @role1 @role2`.")
    .addFields(...fields)
    .setFooter({ text: HELP_FOOTER });
}

function scoresCategory(): EmbedBuilder {
  return helpPage("📊 Scores & Ships")
    .setDescription("For-fun scores refresh every 30 minutes. These are separate from the member-to-member social actions.")
    .addFields(
      { name: "`!aura @user` • `/aura user`", value: "Show that member's aura score, mood, and a matching mood GIF." },
      { name: "`!rizz @user` • `/rizz user`", value: "Show that member's rizz score out of 100." },
      { name: "`!vibecheck @user` • `/vibecheck user`", value: "Show that member's vibe score out of 100." },
      { name: "`!rate @user` • `/rate user`", value: "Give that member a playful rating out of 10." },
      { name: "`!iq @user` • `/iq user`", value: "Show that member's for-fun IQ score out of 200." },
      { name: "`!ship @user1 @user2` • `/ship user1 user2`", value: "Show a fun compatibility score for two different members. The score refreshes every 30 minutes." },
    )
    .setFooter({ text: HELP_FOOTER });
}

const CATEGORY_BUILDERS: Record<CategoryId, () => EmbedBuilder> = {
  home: pageHome,
  start: page1,
  moderation: page2,
  controls: page3,
  automation: pageAutomation,
  utility: page4,
  games: page5,
  economy: pageEconomy,
  friendly: () => socialCategory("Social: Friendly", FRIENDLY_ACTIONS),
  affection: () => socialCategory("Social: Affection", AFFECTION_ACTIONS),
  reactions: () => socialCategory("Social: Reactions", REACTION_ACTIONS),
  scores: scoresCategory,
};

function buildCategoryRow(selected: CategoryId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId("help_category")
    .setPlaceholder("Choose a help category")
    .addOptions(
      CATEGORIES.map((category) => ({
        label: category.label,
        value: category.value,
        description: category.description,
        default: category.value === selected,
      })),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildNavigationRow(selected: CategoryId) {
  const selectedIndex = CATEGORIES.findIndex((category) => category.value === selected);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("help:previous")
      .setLabel("Previous")
      .setEmoji("◀️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(selectedIndex <= 0),
    new ButtonBuilder()
      .setCustomId("help:next")
      .setLabel("Next")
      .setEmoji("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(selectedIndex >= CATEGORIES.length - 1),
  );
}

function buildHelpComponents(selected: CategoryId) {
  return [buildCategoryRow(selected), buildNavigationRow(selected)];
}

function helpIndex(message: Message): EmbedBuilder {
  return helpPage("📖 Help Categories")
    .setDescription("Help details are available privately. Use `!help <category>` in a direct message.")
    .addFields(
      ...CATEGORIES.filter(({ value }) => value !== "home").map((category) => ({
        name: `${category.label} — \`!help ${category.value}\``,
        value: category.description,
        inline: true,
      })),
    )
    .setFooter({ text: "Use !help <category> in DM for command details" });
}

function buildCategoryEmbed(category: CategoryId, message: Message): EmbedBuilder {
  const pageIndex = CATEGORIES.findIndex((item) => item.value === category);
  const embed = CATEGORY_BUILDERS[category]();
  const avatarUrl = message.client.user?.displayAvatarURL({ size: 64 });
  embed.setAuthor({
    name: "MAINZ  •  COMMAND CENTER",
    ...(avatarUrl ? { iconURL: avatarUrl } : {}),
  });
  embed.setFooter({
    text: `PAGE ${pageIndex + 1} / ${CATEGORIES.length}  •  ${HELP_FOOTER}`,
  });
  return embed;
}

export async function handleHelp(message: Message, requestedCategory?: string): Promise<void> {
  if (!requestedCategory) {
    await message.reply({ embeds: [helpIndex(message)] });
    return;
  }

  let currentCategory = CATEGORY_ALIASES[requestedCategory.toLowerCase()];
  if (!currentCategory) {
    await message.reply("Unknown help category. Try `!help games`, `!help moderation`, or `!help economy`.");
    return;
  }

  const helpMsg = await message.reply({
    embeds: [buildCategoryEmbed(currentCategory, message)],
    components: buildHelpComponents(currentCategory),
  });

  const collector = helpMsg.createMessageComponentCollector({
    time: TIMEOUT,
  });

  collector.on("collect", async (interaction) => {
    if (interaction.user.id !== message.author.id) {
      await interaction.reply({
        embeds: [
          premiumEmbed(
            "Only the person who opened this help menu can change its category.",
            { title: "Help menu" },
            message.client?.user,
          ),
        ],
        ephemeral: true,
      });
      return;
    }

    let nextCategory: CategoryId | undefined;
    if (interaction.isStringSelectMenu()) {
      nextCategory = CATEGORIES.find((category) => category.value === interaction.values[0])?.value;
    } else if (interaction.isButton()) {
      const currentIndex = CATEGORIES.findIndex((category) => category.value === currentCategory);
      const nextIndex = currentIndex + (interaction.customId === "help:next" ? 1 : -1);
      nextCategory = CATEGORIES[nextIndex]?.value;
    }

    if (!nextCategory) {
      await interaction.deferUpdate();
      return;
    }

    currentCategory = nextCategory;
    await interaction.update({
      embeds: [buildCategoryEmbed(currentCategory, message)],
      components: buildHelpComponents(currentCategory),
    });
  });

  collector.on("end", async () => {
    await helpMsg.edit({ components: [] }).catch(() => {});
  });
}
