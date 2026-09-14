/**
 * quotes — the home page's one line of borrowed voice: a Reverend Insanity line,
 * chosen by the day and by where the rank stands — and, since the platform was
 * sealed, a line of the mind method from 《地狱十八层：这里禁止说谎》 too.
 *
 * CURATION DOCTRINE (owner-ruled, 2026-08-06). Every entry is one of two kinds:
 * verbatim EXCERPTS of the fan translation as carried on the wiki's quote pages
 * (long passages may be split into line-sized parts and trimmed at the edges —
 * the wording itself is never rewritten), or `unverified` lines: refrains the
 * novel is known to lean on whose exact translated wording hasn't been checked
 * yet — to be confirmed or cut by the owner. Invented in-the-spirit-of lines were
 * purged the same day the rule was made. The 2026-09-15 pass searched the wiki
 * for the four refrains that had waited since August and found none of them, so
 * they were cut; scripture is now verbatim Legends of Ren Zu.
 *
 * THE 18 LEVELS CLASS (2026-09-15). The mind novel has no fan translation (the
 * reader site is machine output that renders 本我 as "True Self"), so its lines
 * are LITERAL translations made here, in the wording the platform seal already
 * carries for the method pages — and every one carries the original in `zh`, so
 * the provenance a reader can check is the sentence itself. Only walked roads
 * are stocked: hell's own rules (admissible always, like scripture), the id
 * booklet and its practice (realm 1), the ego booklet (realm 2) — both realms
 * read "half a foot in" at the 2026-09-07 seal. The superego's lines (失我劫,
 * 鬼仙, the third realm) wait for the seal that moves 超我 off mortal. Nothing
 * past his reading position (ch. 793 on 2026-09-07) is quoted.
 *
 * TIERS follow the wiki's Cultivation table — Fang Yuan's own rank, chapter by
 * chapter, in the second life (the Blood Skull reset at ch. 198 sends him back
 * to rank 1, so two mortal ranks have two windows each):
 *   r1: ch 1–91, 198–232 · r2: 92–151, 233–272 · r3: 152–197, 273–330 ·
 *   r4: 331–474 · r5: 475–632 · r6: 633–1205 · r7: 1206–1766 · r8: 1767–2205 ·
 *   r9: 2206+.
 * Every entry carries its chapter, and the test file holds the same table, so a
 * line sitting in the wrong tier fails CI. The ch. 1285 first-life flashbacks
 * sit in tier 1 deliberately: they are the mortal era remembered. Scripture
 * (`rank: null`) is admissible at every rank — the bible of that world (owner's
 * ruling).
 *
 * Pure and clock-less like its neighbours: the day is an argument, never a
 * `Date.now()`, so the same Sydney date picks the same quote on every device.
 */

export interface RiQuote {
  /** The rank tier this quote belongs to; null = scripture, admissible at EVERY
   *  rank (the owner's ruling: the bible of their world). */
  rank: number | null;
  text: string;
  /** provenance — chapter or source, so the owner can re-tier or verify */
  arc?: string;
  /** the original sentence, for lines translated here rather than excerpted
   *  from a fan translation (the 18 Levels class) — check the wording against it */
  zh?: string;
  /** wording not yet checked against the translation — confirm or cut */
  unverified?: true;
}

export const QUOTES: readonly RiQuote[] = [
  // --- rank 1 · ch 1–91, the Qing Mao era ---------------------------------------
  {
    rank: 1,
    arc: "ch. 1",
    text: "If the Spring Autumn Cicada that I have just cultivated is effective, I shall still be a demon in my next life!",
  },
  {
    rank: 1,
    arc: "ch. 1",
    text: "To be a demon is to be merciless and cruel — turning into an enemy to the world, still having to face the consequences.",
  },
  {
    rank: 1,
    arc: "ch. 1",
    text: "The sun sets above the blue mountain, the autumn moon with the wind of spring. The morning is fine like hair and night is like snow, whether you succeed or fail when you look back there’s nothing left.",
  },
  {
    rank: 1,
    arc: "ch. 2",
    text: "While the cage restricted freedom, the sturdy bars of the cage also brought about a certain kind of safety.",
  },
  {
    rank: 1,
    arc: "ch. 2",
    text: "The strong ate the weak — survival of the fittest; these had always been the rules of this world.",
  },
  {
    rank: 1,
    arc: "ch. 2",
    text: "Revenge is not my intention, the Demonic path does not compromise.",
  },
  {
    rank: 1,
    arc: "ch. 3",
    text: "People are not worried about whether they receive less; people worry about whether whatever they received is undistributed well.",
  },
  {
    rank: 1,
    arc: "ch. 5",
    text: "The Awakening Ceremony was a success! This was the hope to immortality!",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "If others feel disappointed, then let them be disappointed. What else can they do?",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "The most important thing is to carry hope inside my heart!",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "The interesting things that happen in a person's life, happens during the process when one chases after his own dreams.",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "Walk on your own path, let others be disappointed and unhappy however they please!",
  },
  {
    rank: 1,
    arc: "ch. 6",
    text: "Go on. The road to the future will be interesting.",
  },
  {
    rank: 1,
    arc: "ch. 9",
    text: "Men would throw away their lives in pursuit for wealth.",
  },
  {
    rank: 1,
    arc: "ch. 10",
    text: "Only a fool would think others were stupid.",
  },
  {
    rank: 1,
    arc: "ch. 10",
    text: "A storm may arise from a clear sky; something unexpected may happen anytime. In this world who can do everything without obstacles in his way?",
  },
  {
    rank: 1,
    arc: "ch. 11",
    text: "When there is insufficient strength, only a fool would put himself in danger.",
  },
  {
    rank: 1,
    arc: "ch. 12",
    text: "With power, one can be at the top. This is the nature of this world.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "The truth is always hidden inside the fog of history.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "Don't even mention sense of clan honor, everyone has greed in their hearts.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "This is the helplessness of life, but it's also the charm of living.",
  },
  {
    rank: 1,
    arc: "ch. 13",
    text: "The end result of taking a risk was often unsatisfactory. But when the result was ideal, the profit would be impressive.",
  },
  {
    rank: 1,
    arc: "ch. 16",
    text: "Do not depend on anyone; you must rely on yourself on everything in this world.",
  },
  {
    rank: 1,
    arc: "ch. 16",
    text: "You said something about a sense of loyalty and honour to the clan? I’m so sorry, Fang Yuan does not have one bit of that.",
  },
  {
    rank: 1,
    arc: "ch. 19",
    text: "Life is fascinating, because no one will ever know what is waiting for him or her at the next moment.",
  },
  {
    rank: 1,
    arc: "ch. 20",
    text: "A fallen tiger still leaves behind threat; a festered ship still has three pounds of nails.",
  },
  { rank: 1, arc: "ch. 20", text: "Time waits for no one!" },
  {
    rank: 1,
    arc: "ch. 23",
    text: "An inch of gold cannot buy an inch of time. No matter how much money you have, can you buy time? You can't!",
  },
  {
    rank: 1,
    arc: "ch. 24",
    text: "Primeval stones are meant to be used; if you want to become a miser and accumulate primeval stones, then what did you become a Gu Master for?",
  },
  {
    rank: 1,
    arc: "ch. 24",
    text: "As for those with lofty aspirations, they usually showed a tolerant and generous attitude, and had the strength to give up and let go of things.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "Power is like the carrot dangling in front of a donkey.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "Any organization is just a representation, while the real basis is just one word – resources.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "The so-called glory was just a valuable tool the upper levels used to motivate those below them.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "Chasing after profit is the nature of humans, and positions of authority often make people have superiority, creating the illusion that oneself is living a more valuable life than others.",
  },
  {
    rank: 1,
    arc: "ch. 26",
    text: "This is the real truth, yet it is a pity that too many people in the world do not understand; they foolishly work hard for others.",
  },
  {
    rank: 1,
    arc: "ch. 59",
    text: "In this life I hope to become the real moon, rising above the mountains and heavens, toying with the clouds and seas, following the ancient times and walk in the darkness above the various heavens.",
  },
  {
    rank: 1,
    arc: "ch. 66",
    text: "Life and death is nature’s law. All living beings are equal, and everyone has their right to survive and be killed.",
  },
  {
    rank: 1,
    arc: "ch. 75",
    text: "I can kill others, others can naturally come to kill me. This is nothing.",
  },
  // rank 1 again — the Blood Skull reset, ch 198–232
  {
    rank: 1,
    arc: "ch. 227 — rank 1 again, after the reset",
    text: "Because it has no legs, only wings, thus it has no choice but to fly. When it lands, that signifies its destruction.",
  },
  {
    rank: 1,
    arc: "ch. 1285 — the first life, remembered",
    text: "This world is too big, but we are all minor characters… I will work hard! I will definitely do my best!",
  },
  {
    rank: 1,
    arc: "ch. 1285 — the first life, remembered",
    text: "I had once grieved, gradually, I became able to withstand everything. Only perseverance remains in my heart.",
  },

  // --- scripture · The Legends of Ren Zu — admissible at every rank -------------
  // Verbatim from the wiki's Legends page, the parts Fang Yuan reads in the
  // mortal era (ch. 5–287).
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 5",
    text: "This is the Hope Gu, withdraw! We Predicaments are most afraid of hope!",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 5",
    text: "From that day onwards whenever he faced Predicament, he would give his heart to hope.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 5",
    text: "Strength was not everything. It needed to heal and be cultivated, not spent freely at his will.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 38",
    text: "There's always hope in everything.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 38",
    text: "As long as there's hope in my heart, I will not give up!",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 38",
    text: "Even if I die, I will not give up hope!",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 58",
    text: "We can only capture Gu for you, to subdue them, you have to rely on yourself to get them to work for you.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 58",
    text: "Every time you command us, it will add a rule and regulation.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 87",
    text: "Attitude is the mask of the heart.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 131",
    text: "Heart, is nowhere and everywhere. Finding a heart, it is both easy and difficult.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 213",
    text: "Wine is both bitter and sweet, love is the same and human lives are even more so.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 213",
    text: "No matter how good the wine is, you will vomit it out if you drink too much; everything should be taken with moderation.",
  },
  {
    rank: null,
    arc: "Legends of Ren Zu · ch. 287",
    text: "Reputation itself has no voice, but it can spread wide and create tremors.",
  },

  // --- 十八层 · hell's own rules — admissible at every rank ----------------------
  {
    rank: null,
    arc: "十八层 ch. 5 — the first room's wall",
    zh: "对过去说谎：吹牛。 对现在说谎：现编。 对未来说谎：画饼。",
    text: "Lying about the past is bragging. Lying about the present is making it up. Lying about the future is painting a pie.",
  },
  {
    rank: null,
    arc: "十八层 ch. 5",
    zh: "什么情况下不会被判定成说谎？ 推理！ 即便推理出错误答案，也不算说谎。",
    text: "What is never judged a lie? Reasoning. Even a wrong answer reached by reasoning is not a lie.",
  },
  {
    rank: null,
    arc: "十八层 ch. 5",
    zh: "本我掌控情绪。 自我掌控常识。 超我掌控情感。",
    text: "The id governs emotion. The ego governs common sense. The superego governs feeling.",
  },
  {
    rank: null,
    arc: "十八层 ch. 33 — 灵台三尸",
    zh: "心境达到本我，就可以控制自己的情绪，达到自我，就可以无视大部分常识规则！",
    text: "Reach the id and you control your own emotion; reach the ego and you can ignore most of the rules of common sense.",
  },
  {
    rank: null,
    arc: "十八层 ch. 33",
    zh: "想要达到自我心境何其困难啊，不经历一番痛苦的折磨怎么可能会提升心境？",
    text: "How hard it is to reach the ego. Without a round of painful torment, how could a state of mind rise?",
  },
  {
    rank: null,
    arc: "十八层 ch. 34",
    zh: "能说就说，不能说就不要回答，但不要点头或摇头。",
    text: "Say it if you can; if you cannot, do not answer. But never nod, and never shake your head.",
  },
  {
    rank: null,
    arc: "十八层 ch. 236",
    zh: "哪怕是三星顶级玩家，也并非是全能的，都有弱点。",
    text: "Even a top three-star player is not all-powerful. Everyone has a weakness.",
  },
  {
    rank: null,
    arc: "十八层 ch. 236",
    zh: "底牌不能随便亮",
    text: "A trump card is not shown lightly.",
  },
  {
    rank: null,
    arc: "十八层 ch. 290",
    zh: "归根究底，是知道的越多，人越【胆小】。 其实不是【胆小】，而是由知道诞生的理智",
    text: "In the end, the more one knows, the more timid one becomes. It is not timidity; it is the reason born of knowing.",
  },
  {
    rank: null,
    arc: "十八层 ch. 327",
    zh: "什么是真，什么是假，需要你自己判断。",
    text: "What is true and what is false, you must judge for yourself.",
  },
  {
    rank: null,
    arc: "十八层 ch. 545",
    zh: "最完美≠最厉害。",
    text: "The most perfect is not the most powerful.",
  },
  {
    rank: null,
    arc: "十八层 ch. 656 — the proverb turned around",
    zh: "当局者清，旁观者迷。",
    text: "The one in the game sees clearly; the onlooker is the one lost.",
  },
  {
    rank: null,
    arc: "十八层 ch. 656",
    zh: "想要获得强大的实力，就意味着会面临超高的风险",
    text: "To want great strength is to face great risk.",
  },
  {
    rank: null,
    arc: "十八层 ch. 665 — 三心合一",
    zh: "以弱胜强的本质是以强胜弱",
    text: "The essence of the weak beating the strong is the strong beating the weak.",
  },
  {
    rank: null,
    arc: "十八层 ch. 665",
    zh: "却没有真正审视自己，究竟什么心境才是自己的底色！",
    text: "Never truly examining oneself: which state of mind is one's own base colour?",
  },

  // --- 十八层 · realm 1, the id booklet and its practice (half a foot in) --------
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 1",
    zh: "不修心，自由意志杀不死本我。",
    text: "Without cultivating the mind, free will cannot kill the id.",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 2",
    zh: "修心前提明思，明慎，明忍，明变。",
    text: "The precondition of cultivation: clarity of thought, clarity of caution, clarity of endurance, clarity of change.",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 3",
    zh: "过去的你，造就现在的你；还是现在的你，改变过去和未来的你？",
    text: "Did the past you make the present you; or does the present you change the past and future you?",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 5",
    zh: "内外剥离。",
    text: "Strip the inner from the outer.",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 6",
    zh: "区别对待，内绝对主观，外绝对客观。",
    text: "Treat them differently: the inner absolutely subjective, the outer absolutely objective.",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 9",
    zh: "一来一回，便可使自由意志掌控本我。",
    text: "One trip out and back, and free will masters the id.",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 10",
    zh: "一个人要有情绪，身边才会聚集形形色色的伙伴",
    text: "A person must have emotion for companions of every kind to gather around him.",
  },
  {
    rank: null,
    arc: "十八层 ch. 279 — the id booklet, page 10",
    zh: "地狱从来不是利益至上的地狱，而是你，我亲爱的玩家们，你们选择了利益至上。",
    text: "Hell was never a hell of profit above all; it is you, my dear players, who chose profit above all.",
  },
  {
    rank: null,
    arc: "十八层 ch. 280 — Lu Xun's line, as Chen Ran recalls it",
    zh: "这个世界本来没有路，但走得人多了，也就有了路。",
    text: "The world had no roads to begin with; when enough people walk, a road is made.",
  },
  {
    rank: null,
    arc: "十八层 ch. 280",
    zh: "枪在我手。 选择权也在我手中。",
    text: "The gun is in my hand. So is the choice.",
  },
  {
    rank: null,
    arc: "十八层 ch. 280",
    zh: "两个自由意志，相当于两个绝世高手，在脑海中厮杀，修心要做的就是赢，且每场都赢。",
    text: "Two free wills, like two peerless masters, fight it out in the mind. Cultivation is to win, and to win every bout.",
  },
  {
    rank: null,
    arc: "十八层 ch. 280",
    zh: "能来地狱的人，生前都有一部属于自己的血泪史。",
    text: "Everyone who reaches hell carries a history of blood and tears from the life before.",
  },
  {
    rank: null,
    arc: "十八层 ch. 280 — the 23-hour sit",
    zh: "斩本我，竟然比我想象中要简单很多，可能我生前，早就触摸到这一层的门槛了。",
    text: "Cutting the id was far simpler than I imagined. Perhaps in life I had already touched this threshold.",
  },
  {
    rank: null,
    arc: "十八层 ch. 280",
    zh: "我想试试，处于绝对理智状态下的我…… 究竟有多强！",
    text: "I want to find out how strong I am in a state of absolute reason.",
  },
  {
    rank: null,
    arc: "十八层 ch. 521 — 上善若水",
    zh: "上善若水是驯服自己的情绪",
    text: "The highest good is like water: it is taming one's own emotion.",
  },

  // --- 十八层 · realm 2, the ego booklet (half a foot in) ------------------------
  {
    rank: null,
    arc: "十八层 ch. 290 — 无距",
    zh: "无知无距无我，是斩自我的三个前提条件",
    text: "No knowing, no distance, no self: the three preconditions for cutting the ego.",
  },
  {
    rank: null,
    arc: "十八层 ch. 548 — the ego booklet, page 1",
    zh: "不修心，自由意志杀不死自我。",
    text: "Without cultivating the mind, free will cannot kill the ego.",
  },
  {
    rank: null,
    arc: "十八层 ch. 548 — the ego booklet, page 3",
    zh: "我曾经，见山不是山，见水不是水。",
    text: "I once saw the mountain as not a mountain, the water as not water.",
  },
  {
    rank: null,
    arc: "十八层 ch. 553 — the ego booklet, page 7",
    zh: "意识无法反作用于物质，你得到的只是物质。",
    text: "Consciousness cannot act back on matter; what you get is only matter.",
  },
  {
    rank: null,
    arc: "十八层 ch. 553 — the ego booklet, page 10",
    zh: "以上灵台二境的修心之法，都是假的！",
    text: "The method for the second realm written above is all fake!",
  },
  {
    rank: null,
    arc: "十八层 ch. 554 — the two-city debate",
    zh: "常识若真的有这么好否定，那就不叫常识了。",
    text: "If common sense were that easy to negate, it would not be called common sense.",
  },

  // --- rank 2 · ch 92–151 and 233–272 -------------------------------------------
  {
    rank: 2,
    arc: "ch. 101",
    text: "Your great ambitions and aspirations have already disappeared from your youth. These years, you have lived an easy life and it has corrupted your heart.",
  },
  {
    rank: 2,
    arc: "ch. 123",
    text: "White snow blankets the land as I travel alone through heaven and earth. Alone without any attachments, my solitary shadow travels freely.",
  },
  {
    rank: 2,
    arc: "ch. 123",
    text: "While others rushed, Fang Yuan walked alone.",
  },
  {
    rank: 2,
    arc: "ch. 127",
    text: "Not wanting to be trampled on, there are two ways. One is to become strong, strong until no one dares to step on you.",
  },
  {
    rank: 2,
    arc: "ch. 127",
    text: "I would rather let the world down, than be let down by the world!",
  },
  {
    rank: 2,
    arc: "ch. 127",
    text: "What truly stalls a person's success is not talent, but mindset.",
  },
  {
    rank: 2,
    arc: "ch. 128",
    text: "If not for the harshness of the winter, how could we look forward to spring!",
  },
  {
    rank: 2,
    arc: "ch. 131",
    text: "Humans are like isolated islands, floating in the sea of fate.",
  },

  // --- rank 3 · ch 152–197 and 273–330 ------------------------------------------
  {
    rank: 3,
    arc: "ch. 169",
    text: "Humans only live for a hundred years, it is as unreal as a dream that ends in an instant.",
  },
  {
    rank: 3,
    arc: "ch. 169",
    text: "Although I do not want to die, I do not fear death. I am already on my right path, I have no regrets even if I die.",
  },
  {
    rank: 3,
    arc: "ch. 289",
    text: "It is easy to have a long life, but to be an immortal, no one has ever managed to do it.",
  },
  {
    rank: 3,
    arc: "ch. 289",
    text: "For the sake of immortality, wealth, beauty, reputation, status, I can make use of all of them, and I can also discard them as easily!",
  },
  {
    rank: 3,
    arc: "ch. 289",
    text: "For immortality, laziness will not stop me, I will never slack even for a moment!",
  },
  {
    rank: 3,
    arc: "ch. 291",
    text: "Bath in difficulties and sharpen the demonic soul; defy heaven, defy fate, defy the universe!",
  },

  // --- rank 4 · ch 331–474 ------------------------------------------------------
  {
    rank: 4,
    arc: "ch. 399",
    text: "In this world, everyone is a main character, but everyone is also a side character.",
  },
  {
    rank: 4,
    arc: "ch. 399",
    text: "Every living being has the chance to rise up, it depends on how one uses their opportunities, and how one fights!",
  },
  {
    rank: 4,
    arc: "ch. 399",
    text: "In this world, no one is born to be a side character. And there is no one who is an eternal main character.",
  },
  {
    rank: 4,
    arc: "ch. 405",
    text: "Life was a gamble, if one did not gamble when they had the chance, when would they succeed?",
  },
  {
    rank: 4,
    arc: "ch. 405",
    text: "If man did not have aspirations as grand as heaven, they would be letting down their eight feet body!",
  },
  {
    rank: 4,
    arc: "ch. 405",
    text: "Who would not experience failure? Verdant Sun died regretfully. Start over again and proclaim oneself as King.",
  },
  {
    rank: 4,
    arc: "ch. 464",
    text: "There is only immortality, only eternal life should be the goal one should pursue!",
  },
  {
    rank: 4,
    arc: "ch. 467",
    text: "Although an Immortal Gu is good, my goal is eternal life, this so-called Immortal Gu is merely a tool in my cultivation journey.",
  },

  // --- rank 5 · ch 475–632 ------------------------------------------------------
  {
    rank: 5,
    arc: "ch. 533",
    text: "Let blood boil, let sweat flow, the best moment of life is now…",
  },
  {
    rank: 5,
    arc: "ch. 542",
    text: "Man, no matter which world they live in, all lives to conquer; conquer the enemy, conquer themselves…",
  },
  {
    rank: 5,
    arc: "ch. 553",
    text: "In this world, strength was everything.",
  },
  {
    rank: 5,
    arc: "ch. 567",
    text: "Whether eternal life existed or not, there was no evidence to prove it. But even if it did not exist, so what? Fang Yuan enjoyed the process.",
  },
  {
    rank: 5,
    arc: "ch. 567",
    text: "Pursuing eternal life did not mean he was afraid of death or afraid of failure. He calmly accepted death and failure.",
  },
  {
    rank: 5,
    arc: "ch. 599",
    text: "Immortal Venerables and Demon Venerables could only have a long life, but his goal was the greater level of eternal life!",
  },

  // --- rank 6 · ch 633–1205 — a Gu Immortal --------------------------------------
  {
    rank: 6,
    arc: "ch. 647",
    text: "There was no absolutely desperate situation in this world, there were only people who despair.",
  },
  {
    rank: 6,
    arc: "ch. 647",
    text: "To discover oneself, to recognize oneself, and to rely on oneself!",
  },
  {
    rank: 6,
    arc: "ch. 1033",
    text: "Ambitious mountains with steps firm as steel, taking large strides with unwavering determination. Taking risks to obtain the essence of the universe, my heart still seeks to rise beyond heaven.",
  },
  {
    rank: 6,
    arc: "ch. 1113",
    text: "Obstacles and difficulties fill this road, life and death matters little against calamities and tribulations. My body flies like willows with the wind, regardless of wind or mud I still fly free.",
  },

  // --- rank 7 · ch 1206–1766 ----------------------------------------------------
  {
    rank: 7,
    arc: "ch. 1437",
    text: "Compared to them, he was so insignificant. Going against heaven? Interesting.",
  },
  {
    rank: 7,
    arc: "ch. 1544",
    text: "Love and friendship, killing and slaughtering, don't you all find this very boring?",
  },
  {
    rank: 7,
    arc: "ch. 1671",
    text: "Ask yourself, listen to the voice in the depths of your heart. What do you want to do, what kind of person you want to become, where do you want to go?",
  },
  {
    rank: 7,
    arc: "ch. 1671",
    text: "If you mistreat yourself frequently, then you will end up with regrets, you will constantly wear a mask to act as another person, you will no longer be yourself.",
  },
  {
    rank: 7,
    arc: "ch. 1673",
    text: "The vast power of time had changed him, but it also seemed like nothing had changed. He had always been Gu Yue Fang Yuan.",
  },
  {
    rank: 7,
    arc: "ch. 1673",
    text: "Human lives have ups and downs like the waves, sometimes high, sometimes low. Why do we have to be always concerned about victory or defeat?",
  },
  {
    rank: 7,
    arc: "ch. 1673",
    text: "Bold and lofty, free and unrestrained, all kinds of ‘aspirations’ would be washed away by the waves. Even life itself will perish. But what is the big deal?",
  },

  // --- rank 8 · ch 1767–2205 ----------------------------------------------------
  {
    rank: 8,
    arc: "ch. 1786",
    text: "If I lack even this bit of ambition, what's the point of being human? Failure is fine, just try again several times.",
  },
  {
    rank: 8,
    arc: "ch. 1951",
    text: "If an immortal blocks me, I will slay the immortal, if a demon comes, I will slaughter the demon in my way!",
  },

  // --- rank 9 · ch 2206+ — a venerable ------------------------------------------
  {
    rank: 9,
    arc: "ch. 2212 — becoming a venerable",
    text: "In my youth I knew the hardships of the world, yet I still aspired to soar above the clouds.",
  },
  {
    rank: 9,
    arc: "ch. 2212 — becoming a venerable",
    text: "A heart of steel forged from countless setbacks, a lifetime of effort to forge one sword.",
  },
];

const DAY_MS = 86_400_000;

/** A `YYYY-MM-DD` day as a whole number of days since the epoch, or null when the
 *  string is not a day. Built from the day's OWN numbers rather than `Date.now()`,
 *  so the index is a fact about the Sydney calendar date the caller passes in and
 *  every device holding that date lands on the same quote. */
function epochDay(dayISO: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayISO);
  if (m === null) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.floor(t / DAY_MS) : null;
}

/**
 * Today's quote: the current rank's tier plus all scripture, cycled by Sydney
 * day-index (days-since-epoch of the LOCAL Sydney date, modulo tier size).
 * Deterministic; null only if the tier is somehow empty.
 *
 * A day string this build can't read is not a reason to say nothing — the tier's
 * first line stands in, which is still the same line for everyone.
 */
export function quoteForDay(rank: number, dayISO: string): RiQuote | null {
  const tier = QUOTES.filter((q) => q.rank === rank || q.rank === null);
  if (tier.length === 0) return null;
  const day = epochDay(dayISO);
  if (day === null) return tier[0];
  return tier[((day % tier.length) + tier.length) % tier.length];
}
