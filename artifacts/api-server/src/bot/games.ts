import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  type ButtonInteraction,
  type Message,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { premiumColors, premiumMessagePayload } from "./presentation";
import { awardGameCredits } from "./credits";
import { requireGameChannel } from "./gameChannel";
import { FLAG_COUNTRIES } from "./flagCountries";
import { logger } from "../lib/logger";

const ROUND_TIME_MS = 60_000;
const DEFAULT_GAME_REWARD = 100;
const GAME_DROP_COOLDOWN_MS = 15 * 60_000;
const GAME_START_DELAY_MS = 60_000;
const CORRECT_ANSWER_REACTION = "<:tick:1563231489435504650>";
const GAME_REWARD_TIERS = [
  { name: "Common", icon: "<:common:1558505660470010070>", minCredits: 500, maxCredits: 1000, weight: 70 },
  { name: "Rare", icon: "<:rare:1562815035091329034>", minCredits: 1000, maxCredits: 2000, weight: 25 },
  { name: "Epic", icon: "<:epic:1558393073204076607>", minCredits: 3000, maxCredits: 5000, weight: 5 },
] as const;
const GAME_DROP_OPTIONS = [
  { name: "Button Hunt", value: "button-hunt", emoji: { name: "click", id: "1569688192976691271" } },
  { name: "Dice Roll Duel", value: "dice-roll-duel", emoji: { name: "dice", id: "1569688195786874880" } },
  { name: "Word Backwards", value: "word-backwards", emoji: { name: "chat", id: "1563228192259575929", animated: true } },
  { name: "Word Scramble", value: "word-scramble", emoji: { name: "scramble", id: "1569688200577024010" } },
  { name: "Guess the Celebrity", value: "guess-the-celebrity", emoji: { name: "GrayUser", id: "1569688203038953573" } },
  { name: "Guess the Landmark", value: "guess-the-landmark", emoji: { name: "📍" } },
  { name: "Pattern Puzzle", value: "pattern-puzzle", emoji: { name: "maths", id: "1569688205324722357" } },
  { name: "Capital Scramble", value: "capital-scramble", emoji: { name: "world", id: "1563228194247802882" } },
  { name: "Red Light Green Light", value: "red-light-green-light", emoji: { name: "Trafficlight", id: "1569688209934389339", animated: true } },
  { name: "Missing Emoji", value: "missing-emoji", emoji: { name: "❓" } },
  { name: "Sequence Hunt", value: "sequence-hunt", emoji: { name: "Repeat", id: "1569688212748898324" } },
  { name: "Color Hunt", value: "color-hunt", emoji: { name: "Color", id: "1569688215064150053" } },
  { name: "Emoji Equation", value: "emoji-equation", emoji: { name: "quest", id: "1569688441162039408" } },
  { name: "Flag", value: "flag", emoji: { name: "world", id: "1563228194247802882" } },
  { name: "Reaction", value: "reaction", emoji: { name: "reaction", id: "1569688445373390948" } },
  { name: "Language", value: "language", emoji: { name: "category", id: "1569688447613018162" } },
  { name: "Word", value: "word", emoji: { name: "edit", id: "1569688450012024852" } },
  { name: "Nickname", value: "nickname", emoji: { name: "GrayUser", id: "1569688203038953573" } },
  { name: "Emoji", value: "emoji", emoji: { name: "smile", id: "1562366972015026278" } },
  { name: "Trivia", value: "trivia", emoji: { name: "search", id: "1569688457003929630" } },
  { name: "HILO", value: "hilo", emoji: { name: "rankings", id: "1569688462389678150" } },
] as const;
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

type GameType = (typeof GAME_DROP_OPTIONS)[number]["value"];

interface Round {
  type: GameType;
  channelId: string;
  prompt: string;
  answers: Set<string>;
  reward: number;
  rewardTier: (typeof GAME_REWARD_TIERS)[number];
  imageUrl?: string;
  answerOptions?: string[];
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
const gameDropCooldowns = new Map<string, number>();

function gameDropCooldownKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}\p{Regional_Indicator} ]/gu, "")
    .replace(/\s+/g, " ");
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function randomGameReward(): { tier: (typeof GAME_REWARD_TIERS)[number]; credits: number } {
  let tierPick = Math.random() * GAME_REWARD_TIERS.reduce((total, tier) => total + tier.weight, 0);
  const tier = GAME_REWARD_TIERS.find((candidate) => {
    tierPick -= candidate.weight;
    return tierPick < 0;
  }) ?? GAME_REWARD_TIERS[0];
  const credits = Math.floor(Math.random() * (tier.maxCredits - tier.minCredits + 1)) + tier.minCredits;
  return { tier, credits };
}

function gameEmojiMarkup(emoji: (typeof GAME_DROP_OPTIONS)[number]["emoji"]): string {
  if (!("id" in emoji)) return emoji.name;
  return `<${"animated" in emoji && emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

function gameEmoji(type: GameType): string {
  const game = GAME_DROP_OPTIONS.find((option) => option.value === type);
  return game ? gameEmojiMarkup(game.emoji) : GAME_EMOJIS.trophy;
}

function answerButtons(guildId: string, channelId: string, options: string[], disabled = false): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    options.map((option, index) => new ButtonBuilder()
      .setCustomId(`games:answer:${guildId}:${channelId}:${index}`)
      .setLabel(option.slice(0, 80))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled)),
  )];
}

function roundKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function gameLabel(type: GameType): string {
  return GAME_DROP_OPTIONS.find((option) => option.value === type)?.name ?? type;
}

function scrambleWord(word: string): string {
  const letters = [...word];
  for (let index = letters.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [letters[index], letters[swapIndex]] = [letters[swapIndex]!, letters[index]!];
  }
  const scrambled = letters.join("");
  return scrambled.toLowerCase() === word.toLowerCase() ? [...letters].reverse().join("") : scrambled;
}

function countryFlag(code: string): string {
  return [...code.toUpperCase()].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

function createQuestion(type: GameType): { prompt: string; answers: Set<string>; reward: number; imageUrl?: string; answerOptions?: string[] } {
  if (type === "capital-scramble") {
    const question = randomItem(CAPITAL_QUESTIONS);
    const scrambledCapital = scrambleWord(question.capital);
    return {
      prompt: `Unscramble the capital of **${question.country}**: **${scrambledCapital}**`,
      answers: new Set([normalize(question.capital), ...(question.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "guess-the-celebrity") {
    const question = randomItem(CELEBRITY_QUESTIONS);
    return {
      prompt: `Who am I?\n${question.clues}`,
      answers: new Set([normalize(question.name), ...(question.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
      imageUrl: question.imageUrl,
    };
  }

  if (type === "language") {
    const question = randomItem([
      { phrase: "Hola", language: "Spanish", answer: "hello" },
      { phrase: "Merci", language: "French", answer: "thank you", aliases: ["thanks"] },
      { phrase: "Danke", language: "German", answer: "thank you", aliases: ["thanks"] },
      { phrase: "Arigato", language: "Japanese", answer: "thank you", aliases: ["thanks"] },
      { phrase: "Gato", language: "Spanish", answer: "cat" },
      { phrase: "Chat", language: "French", answer: "cat" },
      { phrase: "Amigo", language: "Spanish", answer: "friend" },
    ]);
    return {
      prompt: `Translate **${question.phrase}** from **${question.language}** to English.`,
      answers: new Set([normalize(question.answer), ...(question.aliases ?? []).map(normalize)]),
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
      answers: new Set([String(options.findIndex((option) => normalize(option) === normalize(question.answer)))]),
      reward: DEFAULT_GAME_REWARD,
      answerOptions: options,
    };
  }

  if (type === "pattern-puzzle") {
    const start = Math.floor(Math.random() * 5) + 2;
    const multiplier = Math.floor(Math.random() * 3) + 2;
    const numbers = [start, start * multiplier, start * multiplier ** 2];
    return {
      prompt: `Find the next number: **${numbers.join(", ")}, ?**`,
      answers: new Set([String(numbers[2]! * multiplier)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "emoji-equation") {
    const first = Math.floor(Math.random() * 8) + 2;
    const second = Math.floor(Math.random() * 8) + 2;
    const operation = randomItem(["+", "−", "×"] as const);
    const answer = operation === "+" ? first + second : operation === "−" ? first - second : first * second;
    const symbols = ["🍎", "🍋", "🍇", "🍒", "🥝", "🍉", "🍊", "🍓"];
    return {
      prompt: `Solve: **${randomItem(symbols)} (${first}) ${operation} ${randomItem(symbols)} (${second}) = ?**`,
      answers: new Set([String(answer)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "dice-roll-duel") {
    const first = Math.floor(Math.random() * 6) + 1;
    const second = Math.floor(Math.random() * 6) + 1;
    return {
      prompt: `🎲 **${first}** vs **${second}** — which roll is higher? Type **left**, **right**, or **draw**.`,
      answers: new Set([first > second ? "left" : first < second ? "right" : "draw"]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "word-backwards") {
    const word = randomItem(["planet", "garden", "silver", "puzzle", "rocket", "window"]);
    return {
      prompt: `Type this word backwards: **${[...word].reverse().join("")}**`,
      answers: new Set([normalize(word)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "word-scramble") {
    const word = randomItem(["planet", "garden", "silver", "puzzle", "rocket", "window", "lantern", "diamond"]);
    return {
      prompt: `Unscramble this word: **${scrambleWord(word)}**`,
      answers: new Set([normalize(word)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "word") {
    const question = randomItem(LETTER_QUESTIONS);
    return {
      prompt: `**LETTER: ${question.letter}** · **THEME: ${question.theme.toUpperCase()}**\nName one thing in this theme that starts with **${question.letter}**.`,
      answers: new Set(question.answers.map(normalize)),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "guess-the-landmark") {
    const question = randomItem([
      { clue: "I am an iron tower in Paris.", answer: "Eiffel Tower", aliases: ["eiffel"] },
      { clue: "I am an ancient amphitheatre in Rome.", answer: "Colosseum", aliases: ["coliseum"] },
      { clue: "I am a giant statue overlooking Rio de Janeiro.", answer: "Christ the Redeemer", aliases: ["christ statue"] },
      { clue: "I am an ancient Incan city high in the Andes.", answer: "Machu Picchu", aliases: ["machu"] },
      { clue: "I am a famous white marble mausoleum in Agra.", answer: "Taj Mahal", aliases: ["taj"] },
      { clue: "I am an ancient stone circle in England.", answer: "Stonehenge" },
      { clue: "I am an ancient temple complex in Cambodia.", answer: "Angkor Wat", aliases: ["angkor"] },
    ]);
    return {
      prompt: `Guess the landmark: ${question.clue}`,
      answers: new Set([normalize(question.answer), ...(question.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "button-hunt" || type === "reaction") {
    const options = type === "button-hunt"
      ? ["🟦 Blue", "🟥 Red", "🟩 Green", "🟨 Yellow"]
      : ["Tap 1", "Tap 2", "Tap 3", "Tap 4"];
    const target = Math.floor(Math.random() * options.length);
    return {
      prompt: type === "button-hunt"
        ? `Find and click the **${options[target]!.slice(3)}** button!`
        : "Quick! Click the **TAP!** button first!",
      answers: new Set([String(target)]),
      answerOptions: type === "button-hunt"
        ? options
        : options.map((_, index) => index === target ? "TAP!" : "Wait"),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "red-light-green-light") {
    return {
      prompt: "Red light... green light! Click **GO** to move. Don't click **STOP**!",
      answers: new Set(["0"]),
      answerOptions: ["GO", "STOP", "STOP", "STOP"],
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "hilo") {
    const first = Math.floor(Math.random() * 10) + 1;
    const next = Math.floor(Math.random() * 10) + 1;
    const correct = next > first ? "Higher" : next < first ? "Lower" : "Same";
    const answerOptions = ["Higher", "Lower", "Same"];
    return {
      prompt: `HILO! The first card is **${first}**. Will the next number be higher, lower, or the same?`,
      answers: new Set([String(answerOptions.indexOf(correct))]),
      answerOptions,
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "missing-emoji") {
    const sequence = randomItem([
      ["🐶", "🐱", "🐹", "🐰"],
      ["🍎", "🍌", "🍇", "🍓"],
      ["🚗", "🚕", "🚌", "🚎"],
      ["🌙", "⭐", "☀️", "🌈"],
    ]);
    const missingIndex = Math.floor(Math.random() * sequence.length);
    const answer = sequence[missingIndex]!;
    const shown = sequence.map((emoji, index) => index === missingIndex ? "❔" : emoji);
    return {
      prompt: `Which emoji is missing? **${shown.join(" ")}**`,
      answers: new Set([normalize(answer)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "sequence-hunt") {
    const emojis = ["🔴", "🔵"];
    return {
      prompt: `What comes next? **${emojis[0]} ${emojis[1]} ${emojis[0]} ${emojis[1]} ?**`,
      answers: new Set([normalize(emojis[0])]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "color-hunt") {
    const colors = [
      { name: "red", emoji: "🟥" },
      { name: "blue", emoji: "🟦" },
      { name: "green", emoji: "🟩" },
      { name: "yellow", emoji: "🟨" },
      { name: "purple", emoji: "🟪" },
    ];
    const color = randomItem(colors);
    return {
      prompt: `Name this color: **${color.emoji}**`,
      answers: new Set([color.name, normalize(color.emoji)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "flag") {
    const country = randomItem(FLAG_COUNTRIES);
    return {
      prompt: `Name this flag: **${countryFlag(country.code)}**`,
      answers: new Set([normalize(country.name), ...(country.aliases ?? []).map(normalize)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "nickname") {
    const nickname = randomItem(["Shadow", "Starboy", "Dreamer", "Ace", "Blaze", "Moonlight"]);
    return {
      prompt: `Unscramble this nickname: **${scrambleWord(nickname)}**`,
      answers: new Set([normalize(nickname)]),
      reward: DEFAULT_GAME_REWARD,
    };
  }

  if (type === "emoji") {
    const choices = [
      { emoji: "🐼", names: ["panda"] },
      { emoji: "🦋", names: ["butterfly"] },
      { emoji: "🍍", names: ["pineapple"] },
      { emoji: "🦉", names: ["owl"] },
      { emoji: "🐢", names: ["turtle", "tortoise"] },
    ];
    const choice = randomItem(choices);
    return {
      prompt: `Guess the name of this emoji: **${choice.emoji}**`,
      answers: new Set(choice.names.map(normalize)),
      reward: DEFAULT_GAME_REWARD,
    };
  }
  throw new Error(`Unsupported game type: ${type}`);
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
  await channel.send(premiumMessagePayload(`${round.rewardTier.icon} <@${winnerId}> solved **${gameLabel(round.type)}** first and won <:credits:1558505663531851933> **${round.reward} credits**!`, channel.client.user));
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
): Promise<void> {
  if (rounds.has(roundKey(guildId, channel.id))) return;
  const question = createQuestion(type);
  const { tier: rewardTier, credits } = randomGameReward();
  const round = {
    type,
    channelId: channel.id,
    prompt: question.prompt,
    answers: question.answers,
    reward: credits,
    rewardTier,
    imageUrl: question.imageUrl,
    answerOptions: question.answerOptions,
    timer: undefined as unknown as NodeJS.Timeout,
  } satisfies Round;
  round.timer = setTimeout(() => {
    void endRound(guildId, channel, round);
  }, ROUND_TIME_MS);
  rounds.set(roundKey(guildId, channel.id), round);

  const embed = new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setTitle(`${gameEmoji(type)} ${gameLabel(type)}`)
    .setDescription(`${round.prompt}\n\n${GAME_EMOJIS.trophy} First correct answer wins ${round.rewardTier.icon} <:credits:1558505663531851933> **${round.reward} credits**.\n${GAME_EMOJIS.time} You have **60 seconds**!`);
  if (round.imageUrl) embed.setImage(round.imageUrl);

  await channel.send({
    embeds: [embed],
    ...(round.answerOptions
      ? { components: answerButtons(guildId, channel.id, round.answerOptions) }
      : {}),
  });
}

export async function handleCreditGameCommand(message: Message, args: string[]): Promise<void> {
  const guild = message.guild;
  if (!guild) return;
  if (args.length > 0) {
    await message.reply("Use `!games` to choose a game. Automatic interval-based games have been removed.");
    return;
  }
  const now = Date.now();
  const cooldownExpiresAt = gameDropCooldowns.get(gameDropCooldownKey(guild.id, message.author.id)) ?? 0;
  if (cooldownExpiresAt > now) {
    await message.reply(`⏳ You can drop another game <t:${Math.floor(cooldownExpiresAt / 1000)}:R>.`);
    return;
  }
  if (!(await requireGameChannel(message))) return;
  const channel = message.channel;
  if (channel.type !== ChannelType.GuildText) {
    await message.reply("❌ Game drops can only be started in the configured text channel.");
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`games:drop:${guild.id}`)
    .setPlaceholder("Choose a game to drop")
    .addOptions(GAME_DROP_OPTIONS.map((game) => ({
      label: game.name,
      value: game.value,
      emoji: game.emoji,
    })));
  const embed = new EmbedBuilder()
    .setColor(premiumColors.brand)
    .setDescription(
      `<:pin:1569688178816979044> **Lounge:** <#${channel.id}>\n` +
      "<:hourglass:1569688183070007328> **Cooldown:** **`15 minutes`**\n\n" +
      "<:controller:1569688185750032415> **Choose a game to drop**\n" +
      GAME_DROP_OPTIONS.map((game, index) =>
        `${index === GAME_DROP_OPTIONS.length - 1 ? "<:reply:1569688459973500929>" : "<:replyc:1569688189864771685>"} ${gameEmojiMarkup(game.emoji)} ${game.name}`
      ).join("\n"),
    );
  await message.reply({
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

export async function handleGameDropInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  const [prefix, action, guildId] = interaction.customId.split(":");
  if (prefix !== "games" || action !== "drop" || interaction.guildId !== guildId || !guildId) return;

  const game = GAME_DROP_OPTIONS.find((option) => option.value === interaction.values[0]);
  if (!game) {
    await interaction.reply({ content: "That game option is no longer available.", ephemeral: true });
    return;
  }

  const now = Date.now();
  const cooldownKey = gameDropCooldownKey(guildId, interaction.user.id);
  const cooldownExpiresAt = gameDropCooldowns.get(cooldownKey) ?? 0;
  if (cooldownExpiresAt > now) {
    await interaction.reply({
      content: `⏳ You can drop another game <t:${Math.floor(cooldownExpiresAt / 1000)}:R>.`,
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: "❌ Game drops can only be started in a server text channel.", ephemeral: true });
    return;
  }

  const cooldownEndsAt = now + GAME_DROP_COOLDOWN_MS;
  gameDropCooldowns.set(cooldownKey, cooldownEndsAt);
  const gameEmoji = gameEmojiMarkup(game.emoji);
  try {
    await interaction.deferUpdate();
    await interaction.message.edit({ components: [] });
    const startsAt = now + GAME_START_DELAY_MS;
    const embed = new EmbedBuilder()
      .setColor(premiumColors.brand)
      .setAuthor({ name: "A Mysterious Crate Is Approaching!" })
      .setDescription(
        `<:pin:1569688178816979044> **Channel:** <#${channel.id}>\n` +
        `<:GrayUser:1569688203038953573> **Dropped By:** <@${interaction.user.id}>\n` +
        `<:controller:1569688185750032415> **Game:** ${gameEmoji} ${game.name}\n` +
        `<:hourglass:1569688183070007328> **Starts:** <t:${Math.floor(startsAt / 1000)}:R>`,
      );
    await channel.send({ embeds: [embed] });
    setTimeout(() => {
      void startGameRound(guildId, channel as TextChannel, game.value).catch((error: unknown) => {
        logger.error({ err: error, guildId, channelId: channel.id, game: game.value }, "Could not start selected mini-game");
      });
    }, GAME_START_DELAY_MS);
  } catch (error) {
    if (gameDropCooldowns.get(cooldownKey) === cooldownEndsAt) gameDropCooldowns.delete(cooldownKey);
    logger.error({ err: error, guildId, channelId: channel.id, userId: interaction.user.id }, "Could not announce selected game drop");
    const response = { content: "❌ Could not announce that game drop. Please try again.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
}

export async function handleGameAnswerInteraction(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.customId.startsWith("games:answer:")) return;
  const [, , guildId, channelId, rawIndex] = interaction.customId.split(":");
  const round = interaction.guildId && interaction.channelId
    ? rounds.get(roundKey(interaction.guildId, interaction.channelId))
    : undefined;
  const optionIndex = Number(rawIndex);
  if (!round || interaction.guildId !== guildId || interaction.channelId !== channelId || !round.answerOptions || !Number.isInteger(optionIndex)) {
    await interaction.reply({ content: "This game round has already ended.", ephemeral: true });
    return;
  }

  const selected = round.answerOptions[optionIndex];
  if (!selected) {
    await interaction.reply({ content: "That game option is no longer available.", ephemeral: true });
    return;
  }

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) return;
  if (!round.answers.has(String(optionIndex))) {
    await interaction.reply({ content: `${GAME_EMOJIS.time} Wrong answer. Try again!`, ephemeral: true });
    return;
  }

  // Only the first correct answer wins; claimRound ends the round atomically.
  if (!claimRound(guildId, channelId, round)) {
    await interaction.reply({ content: "Someone already answered this game correctly.", ephemeral: true });
    return;
  }
  await interaction.reply({ content: `${round.rewardTier.icon} Correct! You won <:credits:1558505663531851933> **${round.reward} credits**!`, ephemeral: true });
  await interaction.message.edit({ components: answerButtons(guildId, channelId, round.answerOptions, true) }).catch((error: unknown) => {
    logger.warn({ err: error, guildId, channelId, messageId: interaction.message.id }, "Could not disable game answer buttons");
  });
  await reactToCorrectAnswer(interaction.message, guildId, channelId);
  await awardGameCredits(guildId, interaction.user.id, round.reward);
  await channel.send(premiumMessagePayload(`${round.rewardTier.icon} <@${interaction.user.id}> selected the correct answer and won <:credits:1558505663531851933> **${round.reward} credits**!`, channel.client.user));
}

export async function handleCreditGameAnswer(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.content.trim().startsWith("!")) return;
  const round = rounds.get(roundKey(message.guild.id, message.channel.id));
  if (!round || round.channelId !== message.channel.id) return;
  if (!round.answers.has(normalize(message.content))) return;
  await endRound(message.guild.id, message.channel as TextChannel, round, message.author.id, message);
}