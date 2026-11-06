import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  type ButtonInteraction,
  type Message,
  type TextChannel,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { botGameSettingsTable, db } from "@workspace/db";
import { premiumColors, premiumMessagePayload } from "./presentation";
import { awardGameCredits } from "./credits";
import { logger } from "../lib/logger";

const ROUND_TIME_MS = 60_000;
const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 24 * 60;
const MAX_REWARD = 2_147_483_647;
const DEFAULT_GAME_REWARD = 100;
const CORRECT_ANSWER_REACTION = "<:tick:1563231489435504650>";
const GAME_EMOJIS = {
  capital: "<:world:1563228194247802882>",
  celebrity: "<:trophy:1558393071224365102>",
  letter: "<:reaction:1558393068254666785>",
  trivia: "<:world:1563228194247802882>",
  math: "<:reward:1558393075829702726>",
  number: "<:reaction:1558393068254666785>",
  trophy: "<:trophy:1558393071224365102>",
  time: "<:time:1558393079851917372>",
  reward: "<:reward:1558393075829702726>",
  credits: "<:credits:1558505663531851933>",
} as const;

type GameType = "capital" | "celebrity" | "letter" | "trivia" | "math" | "number";

interface Round {
  type: GameType;
  channelId: string;
  prompt: string;
  answers: Set<string>;
  reward: number;
  imageUrl?: string;
  triviaOptions?: string[];
  triviaWinners: Set<string>;
  timer: NodeJS.Timeout;
}

interface CapitalQuestion {
  country: string;
  capital: string;
  aliases?: string[];
}

interface CelebrityQuestion {
  name: string;
  clues: string;
  imageUrl?: string;
  aliases?: string[];
}

interface LetterQuestion {
  letter: string;
  theme: string;
  answers: string[];
}

interface TriviaQuestion {
  question: string;
  answer: string;
  aliases?: string[];
}

const CAPITAL_QUESTIONS: CapitalQuestion[] = [
  { country: "France", capital: "Paris" },
  { country: "Japan", capital: "Tokyo" },
  { country: "Brazil", capital: "Brasilia", aliases: ["Brasília"] },
  { country: "Canada", capital: "Ottawa" },
  { country: "Egypt", capital: "Cairo" },
  { country: "Germany", capital: "Berlin" },
  { country: "India", capital: "New Delhi", aliases: ["NewDelhi"] },
  { country: "Italy", capital: "Rome" },
  { country: "Kenya", capital: "Nairobi" },
  { country: "Mexico", capital: "Mexico City", aliases: ["MexicoCity"] },
  { country: "Spain", capital: "Madrid" },
  { country: "Australia", capital: "Canberra" },
  { country: "South Korea", capital: "Seoul" },
  { country: "Turkey", capital: "Ankara" },
  { country: "United Kingdom", capital: "London" },
];

const CELEBRITY_QUESTIONS: CelebrityQuestion[] = [
  { name: "Taylor Swift", clues: "I am a singer-songwriter known for Eras, Red, and Love Story.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f2/Taylor_Swift_2_-_2019_by_Glenn_Francis.jpg" },
  { name: "Leonardo DiCaprio", clues: "I am an actor who starred in Titanic, Inception, and The Revenant.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/4/46/Leonardo_DiCaprio_2016.jpg" },
  { name: "Beyonce", clues: "I am a singer known for Lemonade, Halo, and a career with Destiny's Child.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1c/Beyonce_-_The_Mrs._Carter_Show_Tour%2C_Los_Angeles%2C_2013.jpg" },
  { name: "Dwayne Johnson", clues: "I am an actor and former wrestler known as The Rock.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1c/Dwayne_Johnson_2014.jpg" },
  { name: "Adele", clues: "I am a singer known for Hello, Someone Like You, and 21.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/7/7c/Adele_2016.jpg" },
  { name: "Tom Hanks", clues: "I am an actor known for Forrest Gump, Cast Away, and Toy Story.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Tom_Hanks_Toy_Story_3_2010.jpg" },
  { name: "Rihanna", clues: "I am a singer known for Umbrella, Diamonds, and Fenty.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1b/Rihanna_Fenty_2018.png" },
  { name: "Shah Rukh Khan", clues: "I am an Indian actor known as the King of Bollywood.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/1/18/Shah_Rukh_Khan_graces_the_launch_of_the_new_Samsung_phone.jpg" },
  { name: "Cristiano Ronaldo", clues: "I am a Portuguese footballer known for many Champions League goals.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/8/8c/Cristiano_Ronaldo_2018.jpg" },
  { name: "Lady Gaga", clues: "I am a singer and actor known for Poker Face and A Star Is Born.", imageUrl: "https://upload.wikimedia.org/wikipedia/commons/3/3f/Lady_Gaga_at_the_2018_Toronto_International_Film_Festival.jpg" },
  { name: "Selena Gomez", clues: "I am a singer and actor known for Lose You to Love Me and Only Murders in the Building.", aliases: ["selena"] },
  { name: "Justin Bieber", clues: "I am a Canadian singer known for Baby, Sorry, and Peaches.", aliases: ["justin"] },
  { name: "Ariana Grande", clues: "I am a singer known for Thank U, Next, 7 Rings, and Positions.", aliases: ["ariana"] },
  { name: "Ed Sheeran", clues: "I am a singer-songwriter known for Shape of You and Perfect.", aliases: ["ed"] },
  { name: "Billie Eilish", clues: "I am a singer known for Bad Guy and What Was I Made For?", aliases: ["billie"] },
  { name: "Drake", clues: "I am a Canadian rapper and singer known for Hotline Bling and God's Plan." },
  { name: "The Weeknd", clues: "I am a Canadian artist.\nMy hit songs are Blinding Lights, Save Your Tears and Heartless.", aliases: ["weeknd"] },
  { name: "Travis Scott", clues: "I am an American artist.\nMy hit songs are No Bystanders, Butterfly Effect & Highest in the Room.", aliases: ["travis"] },
  { name: "Michael Jackson", clues: "I am an American artist.\nMy hit songs are Billie Jean, Thriller and Beat It.", aliases: ["michael"] },
  { name: "Eminem", clues: "I am a rapper known for Lose Yourself and Without Me." },
  { name: "Katy Perry", clues: "I am a singer known for Roar, Firework, and Dark Horse.", aliases: ["katy"] },
  { name: "Jennifer Lopez", clues: "I am a singer and actor known as J.Lo.", aliases: ["jlo", "j lo"] },
  { name: "Chris Hemsworth", clues: "I am an actor who played Thor in the Marvel films.", aliases: ["thor"] },
  { name: "Robert Downey Jr.", clues: "I am an actor who played Iron Man in the Marvel films.", aliases: ["robert downey", "iron man"] },
  { name: "Will Smith", clues: "I am an actor and rapper known for Men in Black and The Fresh Prince of Bel-Air.", aliases: ["will"] },
  { name: "Jackie Chan", clues: "I am a Hong Kong actor and martial artist known for action-comedy films." },
  { name: "MrBeast", clues: "I am a creator known for huge YouTube challenges and philanthropy.", aliases: ["mr beast"] },
  { name: "Virat Kohli", clues: "I am an Indian cricketer known for batting and former India captaincy.", aliases: ["virat"] },
  { name: "Neeraj Chopra", clues: "I am an Indian Olympic javelin champion.", aliases: ["neeraj"] },
  { name: "Lionel Messi", clues: "I am an Argentine footballer and World Cup winner.", aliases: ["messi"] },
  { name: "Kylian Mbappe", clues: "I am a French footballer known for pace and a World Cup final hat-trick.", aliases: ["mbappe", "kylian"] },
  { name: "David Beckham", clues: "I am an English footballer known for my free kicks and the number 7.", aliases: ["beckham"] },
  { name: "Brad Pitt", clues: "I am an actor known for Fight Club, Troy, and Once Upon a Time in Hollywood.", aliases: ["pitt"] },
  { name: "Angelina Jolie", clues: "I am an actor and filmmaker known for Maleficent and Lara Croft.", aliases: ["angelina"] },
  { name: "Keanu Reeves", clues: "I am an actor known for The Matrix and John Wick.", aliases: ["keanu"] },
  { name: "Chris Evans", clues: "I am an actor who played Captain America in Marvel films.", aliases: ["captain america"] },
  { name: "Scarlett Johansson", clues: "I am an actor who played Black Widow in Marvel films.", aliases: ["scarlett", "black widow"] },
  { name: "Zendaya", clues: "I am an actor and singer known for Euphoria and the Spider-Man films." },
  { name: "Tom Holland", clues: "I am an English actor who played Spider-Man in Marvel films.", aliases: ["spiderman", "spider man"] },
  { name: "Margot Robbie", clues: "I am an Australian actor known for Barbie and I, Tonya.", aliases: ["margot"] },
  { name: "Ryan Reynolds", clues: "I am a Canadian actor known for Deadpool and Free Guy.", aliases: ["ryan"] },
  { name: "Emma Watson", clues: "I am an English actor known for playing Hermione Granger.", aliases: ["hermione"] },
  { name: "Harry Styles", clues: "I am an English singer and actor who was a member of One Direction.", aliases: ["harry"] },
  { name: "Bruno Mars", clues: "I am an American singer known for Uptown Funk and 24K Magic.", aliases: ["bruno"] },
  { name: "Shakira", clues: "I am a Colombian singer known for Hips Don't Lie and Waka Waka." },
  { name: "Miley Cyrus", clues: "I am an American singer and actor known for Wrecking Ball and Hannah Montana.", aliases: ["miley", "hannah montana"] },
  { name: "Snoop Dogg", clues: "I am an American rapper and entertainer known for Gin and Juice.", aliases: ["snoop"] },
  { name: "Jay-Z", clues: "I am an American rapper and entrepreneur known for Empire State of Mind.", aliases: ["jay z", "jayz"] },
  { name: "Nicki Minaj", clues: "I am a Trinidadian-born rapper known for Super Bass and Anaconda.", aliases: ["nicki"] },
  { name: "Cardi B", clues: "I am an American rapper known for Bodak Yellow and WAP.", aliases: ["cardi"] },
  { name: "Aamir Khan", clues: "I am an Indian actor known for 3 Idiots and Dangal.", aliases: ["aamir"] },
  { name: "Amitabh Bachchan", clues: "I am an Indian actor known as the Shahenshah of Bollywood.", aliases: ["amitabh", "big b"] },
  { name: "Deepika Padukone", clues: "I am an Indian actor known for Om Shanti Om and Padmaavat.", aliases: ["deepika"] },
  { name: "Alia Bhatt", clues: "I am an Indian actor known for Raazi and Gangubai Kathiawadi.", aliases: ["alia"] },
  { name: "Rohit Sharma", clues: "I am an Indian cricketer known for powerful batting and multiple double centuries.", aliases: ["rohit"] },
  { name: "Neymar", clues: "I am a Brazilian footballer known for flair and creative play.", aliases: ["neymar jr"] },
  { name: "Serena Williams", clues: "I am an American tennis champion with 23 Grand Slam singles titles.", aliases: ["serena"] },
  { name: "Usain Bolt", clues: "I am a Jamaican sprinter known as the fastest man in the world.", aliases: ["bolt"] },
  { name: "LeBron James", clues: "I am an American basketball player known as King James.", aliases: ["lebron"] },
  { name: "Stephen Curry", clues: "I am an American basketball player known for revolutionizing three-point shooting.", aliases: ["curry", "steph"] },
  { name: "PewDiePie", clues: "I am a Swedish YouTube creator known for gaming and commentary.", aliases: ["pewdie"] },
];

const LETTER_QUESTIONS: LetterQuestion[] = [
  { letter: "K", theme: "fruits or vegetables", answers: ["kiwi", "kale", "kumquat"] },
  { letter: "B", theme: "countries", answers: ["brazil", "belgium", "bhutan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belize", "benin", "bolivia", "botswana", "brunei", "bulgaria", "burkina faso", "burundi"] },
  { letter: "C", theme: "cities", answers: ["cairo", "chicago", "chennai", "chicago", "cape town", "canberra", "casablanca", "copenhagen"] },
  { letter: "M", theme: "names", answers: ["maria", "michael", "maya", "mohammed", "mason", "meera", "mia", "marco", "marks", "maxim", "max", "mariah", "matthew", "matt", "mohit", "mohan", "monica", "mustafa", "manish", "manisha", "megan", "melissa", "mary", "martin", "morgan", "michelle", "mohammad", "munir", "murad"] },
  { letter: "T", theme: "objects", answers: ["table", "telephone", "towel", "television", "telescope", "toothbrush"] },
  { letter: "S", theme: "fruits or vegetables", answers: ["strawberry", "spinach", "squash", "sweet potato"] },
  { letter: "P", theme: "countries", answers: ["pakistan", "panama", "peru", "poland", "portugal", "paraguay", "palau", "palestine", "papua new guinea", "philippines"] },
  { letter: "L", theme: "cities", answers: ["london", "lahore", "lisbon", "lima", "lucknow", "los angeles", "liverpool"] },
];

const TRIVIA_QUESTIONS: TriviaQuestion[] = [
  { question: "Which planet is known as the Red Planet?", answer: "Mars" },
  { question: "How many continents are there on Earth?", answer: "7", aliases: ["seven"] },
  { question: "What is the largest ocean on Earth?", answer: "Pacific Ocean", aliases: ["pacific"] },
  { question: "Who painted the Mona Lisa?", answer: "Leonardo da Vinci", aliases: ["leonardo", "da vinci"] },
  { question: "What is the chemical symbol for gold?", answer: "Au" },
  { question: "Which animal is known as the King of the Jungle?", answer: "Lion" },
  { question: "What is the fastest land animal?", answer: "Cheetah" },
  { question: "How many days are in a leap year?", answer: "366" },
  { question: "What is the capital city of Canada?", answer: "Ottawa" },
  { question: "Which gas do plants absorb from the atmosphere?", answer: "Carbon dioxide", aliases: ["co2", "carbon"] },
  { question: "What is the hardest natural substance?", answer: "Diamond" },
  { question: "Which instrument has black and white keys?", answer: "Piano" },
  { question: "What is the smallest prime number?", answer: "2", aliases: ["two"] },
  { question: "Which country is famous for the Great Pyramids of Giza?", answer: "Egypt" },
  { question: "What is H2O commonly called?", answer: "Water" },
  { question: "Which sport uses a shuttlecock?", answer: "Badminton" },
  { question: "What is the largest mammal in the world?", answer: "Blue whale", aliases: ["bluewhale"] },
  { question: "Who wrote Romeo and Juliet?", answer: "William Shakespeare", aliases: ["shakespeare"] },
  { question: "How many sides does a hexagon have?", answer: "6", aliases: ["six"] },
  { question: "Which language has the most native speakers worldwide?", answer: "Mandarin", aliases: ["mandarin chinese", "chinese"] },
  { question: "What is the currency of Japan?", answer: "Yen" },
  { question: "Which organ pumps blood around the human body?", answer: "Heart" },
  { question: "What is the tallest mountain above sea level?", answer: "Mount Everest", aliases: ["everest"] },
  { question: "Which bird is often associated with delivering messages?", answer: "Pigeon" },
  { question: "What is the freezing point of water in Celsius?", answer: "0", aliases: ["zero"] },
];

const rounds = new Map<string, Round>();
let scheduler: NodeJS.Timeout | undefined;
let schedulerRunning = false;

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ");
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function parseInterval(value: string | undefined): number | null {
  const match = /^(\d+)(m|h)$/i.exec(value ?? "");
  if (!match) return null;
  const amount = Number(match[1]);
  const minutes = amount * (match[2]!.toLowerCase() === "h" ? 60 : 1);
  return Number.isSafeInteger(minutes) && minutes >= MIN_INTERVAL_MINUTES && minutes <= MAX_INTERVAL_MINUTES
    ? minutes
    : null;
}

function parseReward(value: string | undefined): number | null {
  if (!/^\d+$/.test(value ?? "")) return null;
  const reward = Number(value);
  return Number.isSafeInteger(reward) && reward >= 1 && reward <= MAX_REWARD ? reward : null;
}

function triviaButtons(guildId: string, channelId: string, options: string[], disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    options.map((option, index) => new ButtonBuilder()
      .setCustomId(`games:trivia:${guildId}:${channelId}:${index}`)
      .setLabel(option.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)),
  )];
}

function roundKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function gameLabel(type: GameType): string {
  const labels: Record<GameType, string> = {
    capital: "Country Capitals",
    celebrity: "Celebrity Identify",
    letter: "Letter + Theme",
    trivia: "Trivia Quiz",
    math: "Math Challenge",
    number: "Guess the Number",
  };
  return labels[type];
}

function parseGameType(value: string | undefined): GameType | null {
  const normalized = value?.toLowerCase();
  if (normalized === "capital" || normalized === "capitals") return "capital";
  if (normalized === "celebrity" || normalized === "celeb") return "celebrity";
  if (normalized === "letter" || normalized === "theme") return "letter";
  if (normalized === "trivia" || normalized === "quiz") return "trivia";
  if (normalized === "math" || normalized === "mathematics") return "math";
  if (normalized === "number" || normalized === "guess" || normalized === "count" || normalized === "counting") return "number";
  return null;
}

function createQuestion(type: GameType): { prompt: string; answers: Set<string>; reward: number; imageUrl?: string; triviaOptions?: string[] } {
  if (type === "capital") {
    const question = randomItem(CAPITAL_QUESTIONS);
    return {
      prompt: `What is the capital of **${question.country}**?`,
      answers: new Set([normalize(question.capital), ...(question.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "celebrity") {
    const question = randomItem(CELEBRITY_QUESTIONS);
    return {
      prompt: `Who am I?\n${question.clues}`,
      answers: new Set([normalize(question.name), ...(question.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
      imageUrl: question.imageUrl,
    };
  }

  if (type === "letter") {
    const question = randomItem(LETTER_QUESTIONS);
    return {
      prompt: `**LETTER: ${question.letter}**\n**THEME: ${question.theme.toUpperCase()}**\nName something in this theme that starts with **${question.letter}**.`,
      answers: new Set(question.answers.map((answer) => normalize(answer))),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "trivia") {
    const question = randomItem(TRIVIA_QUESTIONS);
    const distractors = TRIVIA_QUESTIONS
      .filter((candidate) => candidate !== question)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map((candidate) => candidate.answer);
    const options = [question.answer, ...distractors].sort(() => Math.random() - 0.5);
    return {
      prompt: question.question,
      answers: new Set([normalize(question.answer), ...(question.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
      triviaOptions: options,
    };
  }

  if (type === "math") {
    const first = Math.floor(Math.random() * 41) + 10;
    const second = Math.floor(Math.random() * 9) + 2;
    const operation = randomItem(["+", "-", "×"] as const);
    const answer = operation === "+" ? first + second : operation === "-" ? first - second : first * second;
    return {
      prompt: `Solve: **${first} ${operation} ${second} = ?**`,
      answers: new Set([String(answer)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  const answer = Math.floor(Math.random() * 10) + 1;
  return {
    prompt: "Guess the secret number between **1 and 10**.",
    answers: new Set([String(answer)]),
    reward: DEFAULT_GAME_REWARD,
  };
}

async function endRound(
  guildId: string,
  channel: TextChannel,
  round: Round,
  winnerId?: string,
  winningMessage?: Message,
): Promise<boolean> {
  if (!claimRound(guildId, channel.id, round)) return false;
  if (winningMessage) {
    await reactToCorrectAnswer(winningMessage, guildId, channel.id);
  }

  if (!winnerId) {
    await channel.send(premiumMessagePayload(`${GAME_EMOJIS.time} Time's up! Nobody solved the **${gameLabel(round.type)}** round.`, channel.client.user));
    return false;
  }

  await awardGameCredits(guildId, winnerId, round.reward);
  await channel.send(premiumMessagePayload(`${GAME_EMOJIS.reward} <@${winnerId}> solved **${gameLabel(round.type)}** first and won ${GAME_EMOJIS.credits} **${round.reward} credits**!`, channel.client.user));
  return true;
}

function claimRound(guildId: string, channelId: string, round: Round): boolean {
  const key = roundKey(guildId, channelId);
  if (rounds.get(key) !== round) return false;
  rounds.delete(key);
  clearTimeout(round.timer);
  return true;
}

async function reactToCorrectAnswer(message: Message, guildId: string, channelId: string): Promise<void> {
  await message.react(CORRECT_ANSWER_REACTION).catch((error) => {
    logger.warn({ err: error, guildId, channelId, messageId: message.id }, "Could not react to correct game answer");
  });
}

async function startGameRound(
  guildId: string,
  channel: TextChannel,
  type: GameType,
  reward: number,
): Promise<void> {
  if (rounds.has(roundKey(guildId, channel.id))) return;
  const question = createQuestion(type);
  const round = {
    type,
    channelId: channel.id,
    prompt: question.prompt,
    answers: question.answers,
    reward,
    imageUrl: question.imageUrl,
    triviaOptions: question.triviaOptions,
    triviaWinners: new Set(),
    timer: undefined as unknown as NodeJS.Timeout,
  } satisfies Round;
  round.timer = setTimeout(() => {
    void endRound(guildId, channel, round);
  }, ROUND_TIME_MS);
  rounds.set(roundKey(guildId, channel.id), round);

  const embed = new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setTitle(`${GAME_EMOJIS[type]} ${gameLabel(type)}`)
    .setDescription(`${round.prompt}\n\n${GAME_EMOJIS.trophy} First correct answer wins ${GAME_EMOJIS.credits} **${round.reward} credits**.\n${GAME_EMOJIS.time} You have **60 seconds**!`);
  if (round.imageUrl) embed.setImage(round.imageUrl);

  await channel.send({
    embeds: [embed],
    ...(round.type === "trivia" && round.triviaOptions
      ? { components: triviaButtons(guildId, channel.id, round.triviaOptions) }
      : {}),
  });
}

export async function handleCreditGameCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  const member = message.member ?? await guild.members.fetch(message.author.id).catch(() => null);
  if (!member?.permissions.has("ManageGuild")) {
    await message.reply("❌ You need **Manage Server** permission to configure games.");
    return;
  }

  const gameType = parseGameType(args[0]);
  if (!gameType) {
    await message.reply("Usage: `!games <capital|celebrity|letter|trivia|math|number> <setup|status|interval|reward|pause|resume|remove>`.");
    return;
  }
  const action = args[1]?.toLowerCase() ?? "status";
  const settings = async () => db.select().from(botGameSettingsTable).where(and(
    eq(botGameSettingsTable.guildId, guild.id),
    eq(botGameSettingsTable.gameType, gameType),
  )).limit(1);

  if (action === "setup" || action === "set") {
    const channel = message.mentions.channels.first();
    const intervalArgument = args.find((value) => parseInterval(value) !== null);
    const rewardArgument = args.find((value) => parseReward(value) !== null && value !== intervalArgument);
    const intervalMinutes = intervalArgument
      ? parseInterval(intervalArgument)
      : (gameType === "math" || gameType === "number" ? 1 : DEFAULT_INTERVAL_MINUTES);
    const reward = rewardArgument ? parseReward(rewardArgument) : DEFAULT_GAME_REWARD;
    if (!channel || channel.type !== 0 || intervalMinutes === null || reward === null) {
      await message.reply(`Usage: \`!games ${gameType} setup #channel [${gameType === "math" || gameType === "number" ? "1m" : "30m"}] [100]\`.`);
      return;
    }
    const now = Date.now();
    await db.insert(botGameSettingsTable)
      .values({ guildId: guild.id, gameType, channelId: channel.id, intervalMinutes, reward, enabled: true, nextGameAt: now + intervalMinutes * 60_000 })
      .onConflictDoUpdate({
        target: [botGameSettingsTable.guildId, botGameSettingsTable.gameType],
        set: { channelId: channel.id, intervalMinutes, reward, enabled: true, nextGameAt: now + intervalMinutes * 60_000, updatedAt: new Date(now) },
      });
    await message.reply(`<:tick:1563231751432704131> **${gameLabel(gameType)}** enabled in ${channel}, every ${intervalMinutes} minutes, reward **${reward} credits**.`);
    return;
  }

  if (action === "status") {
    const [setting] = await settings();
    await message.reply(setting
      ? `${GAME_EMOJIS[gameType]} **${gameLabel(gameType)}**: <#${setting.channelId}>\nInterval: ${setting.intervalMinutes} minutes\nReward: ${setting.reward} credits\nStatus: ${setting.enabled ? "enabled" : "paused"}\nNext game: ${setting.enabled ? `<t:${Math.floor(setting.nextGameAt / 1000)}:R>` : "paused"}`
      : `🎮 **${gameLabel(gameType)}** is not configured. Use \`!games ${gameType} setup #channel [${gameType === "math" || gameType === "number" ? "1m" : "30m"}] [100]\`.`);
    return;
  }

  const [setting] = await settings();
  if (!setting) {
    await message.reply(`❌ Configure **${gameLabel(gameType)}** first with \`!games ${gameType} setup #channel [${gameType === "math" || gameType === "number" ? "1m" : "30m"}] [100]\`.`);
    return;
  }
  const now = Date.now();
  if (action === "interval") {
    const intervalMinutes = parseInterval(args.find((value) => parseInterval(value) !== null));
    if (intervalMinutes === null) {
      await message.reply(`Usage: \`!games ${gameType} interval 30m\` (allowed: 1m–24h).`);
      return;
    }
    await db.update(botGameSettingsTable).set({ intervalMinutes, nextGameAt: now + intervalMinutes * 60_000, updatedAt: new Date(now) }).where(and(eq(botGameSettingsTable.guildId, guild.id), eq(botGameSettingsTable.gameType, gameType)));
    await message.reply(`<:tick:1563231751432704131> **${gameLabel(gameType)}** interval set to **${intervalMinutes} minutes**.`);
    return;
  }
  if (action === "reward") {
    const reward = parseReward(args[1]);
    if (reward === null) {
      await message.reply(`Usage: \`!games ${gameType} reward <amount>\` (1–${MAX_REWARD.toLocaleString()}).`);
      return;
    }
    await db.update(botGameSettingsTable).set({ reward, updatedAt: new Date(now) }).where(and(eq(botGameSettingsTable.guildId, guild.id), eq(botGameSettingsTable.gameType, gameType)));
    await message.reply(`<:tick:1563231751432704131> **${gameLabel(gameType)}** reward set to **${reward} credits**.`);
    return;
  }
  if (action === "pause" || action === "resume") {
    const enabled = action === "resume";
    await db.update(botGameSettingsTable).set({ enabled, nextGameAt: enabled ? now + setting.intervalMinutes * 60_000 : setting.nextGameAt, updatedAt: new Date(now) }).where(and(eq(botGameSettingsTable.guildId, guild.id), eq(botGameSettingsTable.gameType, gameType)));
    await message.reply(`<:tick:1563231751432704131> Automatic **${gameLabel(gameType)}** ${enabled ? "resumed" : "paused"}.`);
    return;
  }
  if (action === "remove" || action === "off") {
    await db.delete(botGameSettingsTable).where(and(eq(botGameSettingsTable.guildId, guild.id), eq(botGameSettingsTable.gameType, gameType)));
    await message.reply(`<:tick:1563231751432704131> Automatic **${gameLabel(gameType)}** removed.`);
    return;
  }

  await message.reply(`Usage: \`!games ${gameType} setup #channel [30m] [100]\`, \`interval 30m\`, \`reward 100\`, \`status\`, \`pause\`, \`resume\`, or \`remove\`.`);
}

export function startGamesScheduler(client: import("discord.js").Client): void {
  if (scheduler) return;
  const run = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const now = Date.now();
      const settings = await db.select().from(botGameSettingsTable).where(and(eq(botGameSettingsTable.enabled, true)));
      for (const setting of settings) {
        if (setting.nextGameAt > now || rounds.has(roundKey(setting.guildId, setting.channelId))) continue;
        const [reserved] = await db.update(botGameSettingsTable)
          .set({ nextGameAt: now + setting.intervalMinutes * 60_000, updatedAt: new Date(now) })
          .where(and(
            eq(botGameSettingsTable.guildId, setting.guildId),
            eq(botGameSettingsTable.gameType, setting.gameType),
            eq(botGameSettingsTable.enabled, true),
            eq(botGameSettingsTable.nextGameAt, setting.nextGameAt),
          ))
          .returning({ guildId: botGameSettingsTable.guildId });
        if (!reserved) continue;
        const channel = await client.channels.fetch(setting.channelId).catch(() => null);
        const gameType = parseGameType(setting.gameType);
        if (gameType && channel?.type === 0 && channel.isSendable()) {
          await startGameRound(setting.guildId, channel as TextChannel, gameType, setting.reward).catch((error) => {
            console.error("Could not start scheduled game", error);
          });
        }
      }
    } finally {
      schedulerRunning = false;
    }
  };
  scheduler = setInterval(() => void run(), 30_000);
  scheduler.unref();
  void run();
}

export async function handleCreditGameInteraction(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith("games:trivia:")) return;
  const [, , guildId, channelId, rawIndex] = interaction.customId.split(":");
  const round = interaction.guildId && interaction.channelId
    ? rounds.get(roundKey(interaction.guildId, interaction.channelId))
    : undefined;
  const optionIndex = Number(rawIndex);
  if (!round || round.type !== "trivia" || interaction.guildId !== guildId || interaction.channelId !== channelId || !round.triviaOptions || !Number.isInteger(optionIndex)) {
    await interaction.reply({ content: "This trivia round has already ended.", ephemeral: true });
    return;
  }

  const selected = round.triviaOptions[optionIndex];
  if (!selected) {
    await interaction.reply({ content: "That answer option is no longer available.", ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return;
  if (!round.answers.has(normalize(selected))) {
    await interaction.reply({ content: `${GAME_EMOJIS.time} Wrong answer. Try again!`, ephemeral: true });
    return;
  }

  if (round.triviaWinners.has(interaction.user.id)) {
    await interaction.reply({ content: "You already received the reward for this trivia question.", ephemeral: true });
    return;
  }
  round.triviaWinners.add(interaction.user.id);
  await interaction.reply({ content: `${GAME_EMOJIS.reward} Correct! You won ${GAME_EMOJIS.credits} **${round.reward} credits**!`, ephemeral: true });
  await reactToCorrectAnswer(interaction.message, guildId, channelId);
  await awardGameCredits(guildId, interaction.user.id, round.reward);
  await channel.send(premiumMessagePayload(`${GAME_EMOJIS.reward} <@${interaction.user.id}> selected the correct answer and won ${GAME_EMOJIS.credits} **${round.reward} credits**!`, channel.client.user));
}

export async function handleCreditGameAnswer(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.content.trim().startsWith("!")) return;
  const round = rounds.get(roundKey(message.guild.id, message.channel.id));
  if (!round || round.channelId !== message.channel.id) return;
  if (!round.answers.has(normalize(message.content))) return;
  if (round.type === "trivia") {
    if (round.triviaWinners.has(message.author.id)) return;
    round.triviaWinners.add(message.author.id);
    await awardGameCredits(message.guild.id, message.author.id, round.reward);
    await reactToCorrectAnswer(message, message.guild.id, message.channel.id);
    return;
  }
  await endRound(message.guild.id, message.channel as TextChannel, round, message.author.id, message);
}