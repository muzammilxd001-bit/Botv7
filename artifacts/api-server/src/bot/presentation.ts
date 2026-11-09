import {
  EmbedBuilder,
  type APIEmbed,
  type ClientUser,
  type Message,
  type MessageCreateOptions,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { botEmbedOverridesTable, db } from "@workspace/db";
import { SOCIAL_ACTION_NAMES } from "./social";

const BRAND_COLOR = 0x2b2d31;
const SUCCESS_COLOR = BRAND_COLOR;
const WARNING_COLOR = BRAND_COLOR;
const ERROR_COLOR = BRAND_COLOR;
const PLAIN_TEXT_COMMANDS = new Set(["cf", "coinflip", "gamble", "rob"]);

function responseColor(_text: string): number {
  return BRAND_COLOR;
}

function asApiEmbed(value: unknown): APIEmbed {
  if (value && typeof value === "object" && "toJSON" in value) {
    const toJSON = (value as { toJSON?: () => APIEmbed }).toJSON;
    if (typeof toJSON === "function") return toJSON.call(value);
  }
  return value as APIEmbed;
}

function brandEmbed(
  value: unknown,
  user: ClientUser | null,
  fallbackText: string,
  suppressFooter = false,
): EmbedBuilder {
  const data = asApiEmbed(value);
  const embed = EmbedBuilder.from(data).setColor(BRAND_COLOR);

  if (suppressFooter) {
    embed.setFooter(null);
  } else {
    const existingFooter = data.footer?.text?.trim();
    if (existingFooter) {
      const footerIcon = data.footer?.icon_url ?? user?.displayAvatarURL({ size: 64 });
      embed.setFooter(footerIcon ? { text: existingFooter, iconURL: footerIcon } : { text: existingFooter });
    } else {
      embed.setFooter(null);
    }
  }
  return embed;
}

const overrideCache = new Map<string, {
  expiresAt: number;
  settings: Awaited<ReturnType<typeof loadEmbedOverride>>;
}>();

type EmbedOverride = typeof botEmbedOverridesTable.$inferSelect | null;

async function loadEmbedOverride(guildId: string, commandKey: string): Promise<EmbedOverride> {
  const [settings] = await db
    .select()
    .from(botEmbedOverridesTable)
    .where(and(
      eq(botEmbedOverridesTable.guildId, guildId),
      eq(botEmbedOverridesTable.commandKey, commandKey),
    ));
  return settings ?? null;
}

export function invalidateEmbedOverrideCache(guildId: string, commandKey: string): void {
  overrideCache.delete(`${guildId}:${commandKey}`);
}

async function getEmbedOverride(guildId: string, commandKey: string) {
  const key = `${guildId}:${commandKey}`;
  const cached = overrideCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  const settings = await loadEmbedOverride(guildId, commandKey);
  overrideCache.set(key, { settings, expiresAt: Date.now() + 60_000 });
  return settings;
}

function commandKeyFromMessage(message: Message): string | null {
  const match = /^(?:!|\/)?([a-z0-9_-]+)/i.exec(message.content.trim());
  const key = match?.[1]?.toLowerCase();
  return key && key !== "embed" ? key : null;
}

function applyEmbedOverride(embed: EmbedBuilder, settings: EmbedOverride): EmbedBuilder {
  if (!settings) return embed;
  if (settings.title !== null) embed.setTitle(settings.title);
  if (settings.description !== null) embed.setDescription(settings.description);
  if (settings.color) embed.setColor(Number.parseInt(settings.color.slice(1), 16));
  if (settings.authorText !== null) embed.setAuthor({ name: settings.authorText });
  if (settings.imageUrl) embed.setImage(settings.imageUrl);
  if (settings.thumbnailUrl) embed.setThumbnail(settings.thumbnailUrl);
  if (settings.footerText !== null) embed.setFooter({ text: settings.footerText });
  if (settings.fields !== null) embed.setFields(settings.fields);
  return embed;
}

function styleReplyPayload(
  payload: unknown,
  user: ClientUser | null,
  clearExistingContent = false,
  override: Awaited<ReturnType<typeof loadEmbedOverride>> = null,
  suppressFooter = false,
): unknown {
  if (typeof payload !== "string" && (!payload || typeof payload !== "object")) {
    return payload;
  }

  const options: Record<string, unknown> =
    typeof payload === "string"
      ? { content: payload }
      : { ...(payload as Record<string, unknown>) };
  const omitHelpFooter = suppressFooter || options["suppressHelpFooter"] === true;
  delete options["suppressHelpFooter"];
  const content = typeof options.content === "string" ? options.content : "";
  const existingEmbeds = Array.isArray(options.embeds) ? options.embeds : [];

  if (existingEmbeds.length > 0) {
    const hasGeneratedQuoteImage = existingEmbeds.some(
      (embed) => asApiEmbed(embed).image?.url === "attachment://quote.png",
    );
    options.embeds = existingEmbeds.map((embed) => {
      const branded = brandEmbed(embed, user, content, omitHelpFooter);
      const styled = hasGeneratedQuoteImage ? branded : applyEmbedOverride(branded, override);
      if (omitHelpFooter) styled.setFooter(null);
      return styled;
    });
    return options;
  }

  if (content.trim()) {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setDescription(content.slice(0, 4096));
    if (clearExistingContent) {
      options.content = null;
    } else {
      delete options.content;
    }
    const styled = applyEmbedOverride(embed, override);
    if (omitHelpFooter) styled.setFooter(null);
    options.embeds = [styled];
  }

  return options;
}

async function styleChannelPayload(
  payload: unknown,
  user: ClientUser | null,
  override: EmbedOverride,
): Promise<unknown> {
  if (!payload || typeof payload !== "object") return payload;
  const options = payload as Record<string, unknown>;
  if (!Array.isArray(options.embeds) || options.embeds.length === 0) return payload;
  const content = typeof options.content === "string" ? options.content : "";
  return {
    ...options,
    embeds: options.embeds.map((embed) =>
      applyEmbedOverride(brandEmbed(embed, user, content), override),
    ),
  };
}

/**
 * Applies a shared branded style to command replies without changing how
 * individual command handlers build their payloads.
 */
export function withPremiumReplies(message: Message, user: ClientUser | null): Message {
  const commandKey = commandKeyFromMessage(message);
  const guildId = message.guildId;
  const suppressFooter = commandKey === "afk" || commandKey === "ship" ||
    (commandKey !== null && SOCIAL_ACTION_NAMES.includes(commandKey as (typeof SOCIAL_ACTION_NAMES)[number]));
  const style = async (payload: unknown, clearExistingContent = false) => {
    if (commandKey && PLAIN_TEXT_COMMANDS.has(commandKey)) return payload;
    const override = guildId && commandKey
      ? await getEmbedOverride(guildId, commandKey)
      : null;
    return styleReplyPayload(payload, user, clearExistingContent, override, suppressFooter);
  };
  const wrap = (target: Message): Message =>
    new Proxy(target, {
      get(original, property) {
        if (property === "reply") {
          return async (payload: unknown) => {
            const reply = original.reply.bind(original) as (value: unknown) => Promise<Message>;
            return wrap(await reply(await style(payload)));
          };
        }
        if (property === "edit") {
          return async (payload: unknown) => {
            const edit = original.edit.bind(original) as (value: unknown) => Promise<Message>;
            return wrap(await edit(await style(payload, true)));
          };
        }
        if (property === "channel") {
          const channel = Reflect.get(original, property, original);
          return new Proxy(channel, {
            get(target, channelProperty) {
              if (channelProperty === "send") {
                return async (payload: unknown) => {
                  const send = Reflect.get(target, "send", target);
                  if (typeof send !== "function") {
                    throw new TypeError("This channel does not support sending messages");
                  }
                  const override = guildId && commandKey
                    ? await getEmbedOverride(guildId, commandKey)
                    : null;
                  return Reflect.apply(
                    send,
                    target,
                    [await styleChannelPayload(payload, user, override)],
                  );
                };
              }
              const value = Reflect.get(target, channelProperty, target);
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        }

        const value = Reflect.get(original, property, original);
        return typeof value === "function" ? value.bind(original) : value;
      },
    });

  return wrap(message);
}

export function premiumMessagePayload(
  payload: string | MessageCreateOptions,
  user: ClientUser | null,
): MessageCreateOptions {
  return styleReplyPayload(payload, user) as MessageCreateOptions;
}

export function premiumEmbed(
  description: string,
  options: { title?: string; color?: number; thumbnail?: string } = {},
  _user?: ClientUser | null,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setDescription(description.slice(0, 4096))
    .setTimestamp();

  if (options.title) embed.setTitle(options.title);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  return embed;
}

export const premiumColors = {
  brand: BRAND_COLOR,
  success: SUCCESS_COLOR,
  warning: WARNING_COLOR,
  error: ERROR_COLOR,
} as const;
