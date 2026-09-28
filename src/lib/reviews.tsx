import type { ReactNode } from "react";
import { Spoiler } from "@/components/SpoilerFold";

/**
 * /novels/[slug] — the long-form reviews, versioned in code like the notes. One
 * review per book, written after a first read and revised after the next. A
 * review links to its row on /novels by the novel's English title (`novel` ===
 * `Novel.en`), so the curated list stays the single source for the shelf.
 */
export interface NovelReview {
  slug: string;
  /** matches `Novel.en` in lib/novels */
  novel: string;
  /** which read this review was written after, e.g. "first read" */
  read: string;
  /** where the read stopped, e.g. "caught up at ch. 949 (the latest in english)" */
  caughtUp: string;
  /** how it was read, e.g. "ai translation" */
  via: string;
  /** ISO date the review was written */
  date: string;
  /** one plain-text line for the page description / link unfurl */
  summary: string;
  /** set when the body carries inline <Spoiler> folds: the page shows the
   * warning line and the show-all toggle */
  spoilers?: boolean;
  sections: { id: string; title: string; body: ReactNode }[];
}

const zh = "font-[family-name:var(--font-zh)]";

export const reviews: NovelReview[] = [
  {
    slug: "eighteen-levels-of-hell",
    novel: "The Eighteen Levels of Hell: Lying Is Forbidden",
    read: "first read",
    caughtUp: "caught up at ch. 949 (the latest in english)",
    via: "ai translation",
    date: "2026-09-28",
    summary:
      "yes, but probably not for you. the novel is amazingly good. the problem is the reader, not the book.",
    sections: [
      {
        id: "verdict",
        title: "the verdict",
        body: (
          <p>
            yes, but probably not for you. the novel is amazingly good. the
            problem is the reader, not the book. the building blocks are simple,
            but the author applies them with a robustness that makes reading
            feel like working through a maths problem. you have to follow the
            logic and hold key facts across each &quot;instance&quot; or you get
            lost, and most people won&apos;t put in that work. if you love smart
            characters doing smart things, no deus ex machina, every opponent as
            sharp as the lead so every encounter is thought out instead of
            &quot;i&apos;m stronger, i win&quot;, this is one of the best things
            you&apos;ll read.
          </p>
        ),
      },
      {
        id: "pitch",
        title: "the pitch",
        body: (
          <p>
            i don&apos;t read this as a cultivation novel. it&apos;s closer to a
            philosophy book that borrows from history and runs on logic, and the
            world is built out of those three things. the hook is watching
            someone get outsmarted. but once the lead and his opponent sit at
            the same level, or the opponent is stronger, the fights stop being
            about cleverness and turn into stranger things: time, emotion,
            memory.
          </p>
        ),
      },
      {
        id: "about",
        title: "what it's about",
        body: (
          <p>
            i couldn&apos;t put it into a sentence on this read, so take this as
            a first guess. hell forbids lying, but the deceivers win by turning
            lies into common sense, so the thing that kills you is never the lie
            you can see. it&apos;s the belief you never checked. the power
            system is the same idea pointed inward: strip out what emotion,
            inherited common sense and feeling put in you, and see what&apos;s
            left. so if the book is about anything, it&apos;s about how little
            of what you think is yours actually is. i&apos;ll know more after
            the second read.
          </p>
        ),
      },
      {
        id: "works",
        title: "what works",
        body: (
          <ul>
            <li>
              power has a clear structure. fights enforce the levels strictly,
              nothing comes out of nowhere, everything stays within reason.
            </li>
            <li>
              everyone is smart. this is the whole novel. every character is a
              generational planner with battle iq. it&apos;s like RI if every
              character were a wisdom path cultivator and the only way out is to
              outthink them.
            </li>
            <li>
              the author&apos;s range. ancient chinese literature, history,
              logic problems like hilbert&apos;s hotel, time travel mechanics,
              causality, memory. the amount he knows, and the way he turns all
              of it into fights, is the part that keeps me reading.
            </li>
            <li>
              the cast. the main group all have their own personalities, and so
              do the antagonists, because everyone in hell thinks they&apos;re
              the protagonist of their own story. the ruthlessness it takes to
              survive and rank up demands it. i like these people. when chen ran
              is on the page i&apos;m having a good time.
            </li>
          </ul>
        ),
      },
      {
        id: "doesnt",
        title: "what doesn't",
        body: (
          <ul>
            <li>
              it is extremely hard to follow. an ai translation on top of an
              already difficult premise means following the logic of the
              characters and their skills takes real work. you read each arc in
              one go, or twice, and even then i wouldn&apos;t say i fully
              understand the reasoning every time.
            </li>
            <li>
              the complexity comes from moving parts and references. if you
              match the author&apos;s knowledge you&apos;ll have a great time.
              if you haven&apos;t read journey to the west or three-body, some
              of what he&apos;s doing will pass you by, and those two are the
              tip of the iceberg. he pulls from a lot more than that.
            </li>
            <li>
              character development is thin. the focus is the battles, and
              backstories arrive as flashbacks at key moments to explain why
              someone has a skill or acts a certain way, not to grow them. it
              didn&apos;t bother me, but if you read for arcs, know that going
              in.
            </li>
            <li>
              there&apos;s close to no world building. it&apos;s hell, everyone
              here has died, other places are hinted at but we haven&apos;t
              reached them. a novel like RI has a lot (not the pinnacle, but a
              lot). this has almost none, and it doesn&apos;t seem to want any.
            </li>
          </ul>
        ),
      },
      {
        id: "who",
        title: "who it's for",
        body: (
          <>
            <p>
              if you liked usogui or reverend insanity for the mind games, this
              is the next step up. it surpasses both on that axis. the
              comparison only holds on that one axis though. RI does smart
              characters in a fighting context. this does it as problem solving,
              and in other respects they aren&apos;t that alike.
            </p>
            <p>
              the idea they share is the old saying both books lean on: heaven
              derives fifty and uses forty-nine, and the one left over is where
              a person slips through (
              <span lang="zh" className={zh}>
                大道五十，天衍四九，人遁其一
              </span>
              ). a fight never has a zero percent chance. this book makes that
              the whole game. you can try to work out the escape before the
              character does, which is why it reads like a problem-solving
              exercise rather than a novel with grand scenery and emotive
              characters. if that sounds like work, it is, and it&apos;s the
              point.
            </p>
          </>
        ),
      },
      {
        id: "stuck",
        title: "the bit that stuck",
        body: (
          <>
            <p>
              the power system. it&apos;s just mental strength, and it&apos;s
              the best thing in the book.
            </p>
            <p>
              hell forbids lying, and the tutorial wall sorts lies into three
              kinds: lies out of emotion, lies against common sense, and lies
              inside feeling (friendship, family, love). chen ran reads that
              wall and maps it straight onto freud. the id governs emotion, the
              ego governs common sense, the superego governs feeling. that one
              mapping becomes the whole cultivation system. you climb by cutting
              each layer of yourself in turn: cut the id and emotion-baiting
              stops working on you, cut the ego and you become sensitive to
              every piece of common sense someone planted in you, reach the
              superego and you stop being a piece on the board and become a
              player. each crossing goes through a loss of self, and the book is
              strict that skipping the loss leaves you a half-thing.
            </p>
            <p>
              then it keeps going. that freudian track turns out to be one of
              three schools. a daoist one where your five feelings stand in your
              mind as figures and you tame one, your base colour. a confucian
              one built on order, with two cities in your head, one bound by
              rules and one free of them. three plus five plus two realms, and
              the strongest form is not all ten but your strongest from each,
              assembled. the method pages are where the references stack up: the
              daodejing, the chan line about the mountain not being a mountain,
              hegel&apos;s negation of the negation, materialism, the daoist
              idea of cutting the three corpses that gives the system its name.
              every page of the method is a borrowed idea turned into a
              mechanic.
            </p>
            <p>
              that&apos;s what stuck. the novel is so engaging that i would read
              an entire other book just to understand the drops of reference it
              makes in passing. i&apos;ve never had a novel do that to me
              before.
            </p>
          </>
        ),
      },
      {
        id: "practical",
        title: "practical",
        body: (
          <p>
            the ai translation online is good enough to get through. when a
            section doesn&apos;t land, stop and retranslate or read it two or
            three times, because it&apos;s hard to tell whether the problem is
            the translation or you not following the meaning. it took me five
            months for about a thousand chapters. i could have gone faster and
            understood less. there are no slow patches. the antagonists are
            actively hunting the leads so nobody gets to rest. if anything
            it&apos;s too fast: i&apos;d have liked more time in the levels
            themselves, exploring places, meeting people. but if i wanted that
            i&apos;d read slice of life. that&apos;s not what this is.
          </p>
        ),
      },
      {
        id: "reread",
        title: "reread",
        body: (
          <p>
            must. probably many times, to get as close as i can to the
            author&apos;s intended meaning. blast your brain with a thousand,
            then ten thousand, and when you go back and start from ten it reads
            easy. the brain has seen worse.
          </p>
        ),
      },
    ],
  },
  {
    slug: "reverend-insanity",
    novel: "Reverend Insanity",
    read: "first read",
    caughtUp: "finished at ch. 2334, the pre-ban end (aug 2024 → feb 2025)",
    via: "human translation",
    date: "2026-09-29",
    spoilers: true,
    summary:
      "must read. the gate isn't the villain lead people warn you about. it's the length, and one long arc in the middle that asks you to keep walking.",
    sections: [
      {
        id: "verdict",
        title: "the verdict",
        body: (
          <p>
            must read. i said that the night i finished it, with the last
            chapter cutting out mid-fight and nothing resolved, and it&apos;s
            still what i&apos;d say. five months on and off for one novel is a
            lot of time, and it was worth every bit. the gate isn&apos;t the
            villain lead people warn you about. it&apos;s the length, and one
            long arc in the middle that asks you to keep walking. if you can do
            that, you get cultivation done correctly, a diamond in all the slop.
          </p>
        ),
      },
      {
        id: "pitch",
        title: "the pitch",
        body: (
          <p>
            a cultivator who has already lived five hundred years gets sent back
            to the start with everything he learned. cultivation runs on gu,
            insects that each grant one ability, refined and combined like a
            kit, and the world keeps inventing new methods, so the ancients
            aren&apos;t automatically the strongest. his goal is one line,
            eternal life, and he&apos;s told early it&apos;s impossible. he goes
            anyway. the whole novel is the distance between him and it.
          </p>
        ),
      },
      {
        id: "about",
        title: "what it's about",
        body: (
          <>
            <p>
              the journey, not the destination, and the book tells you that
              early. other stories use that line at the end as the gotcha, to
              justify a questionable ending with &quot;it was the journey all
              along&quot;. this one says it up front: the goal is impossible,
              the road will be tragic, painful and lonely, and he still does all
              he can. a clearly defined goal with the middle stretched so far
              you can&apos;t gauge what&apos;s left. i think that&apos;s what
              good writing is.
            </p>
            <p>
              running beside the main story is the legends of ren zu, the
              world&apos;s own myth, told a piece at a time. each piece is a
              lesson, and each one lands right when a character is living it.
              it&apos;s how the book carries its themes without stopping to
              preach them.
            </p>
          </>
        ),
      },
      {
        id: "works",
        title: "what works",
        body: (
          <ul>
            <li>
              the mc. a transmigrator done correctly. he carries what he learned
              on earth, adapts to this world, and acts like someone who has
              already lived a long time. compare the slop counterparts where the
              mc loses his mind, does something questionable and acts like a
              literal fifteen year old. fang yuan stays true to what his
              character is depicted to be, and that consistency is what makes
              following him satisfying.
            </li>
            <li>
              nothing is withheld. my pet peeve is authors hiding the plan and
              the motive from the audience, not just from the other characters,
              and making you wait until the final chapter to find out why any of
              it happened. when the whole point of the arc is why, withholding
              the answer from the reader is just plot twist slop. that&apos;s
              attack on titan&apos;s entire back half. RI does hide things
              sometimes,{" "}
              <Spoiler k="rank9">
                like fang yuan hiding his rank 9 from both the venerables and
                the reader,
              </Spoiler>{" "}
              but that&apos;s one section done for mystery, and it makes sense
              in context. the story isn&apos;t built on it. at every other point
              you know what he wants and why, so the tension is in watching him
              pull it off, not in decoding him.
            </li>
            <li>
              the power system. the closest thing i can compare it to is nen in
              hunter x hunter: one simple base, gu here, nen there, and
              everything built on top of it. both are good. RI is better because
              it&apos;s clearly defined. in hxh it&apos;s often ambiguous how
              strong someone is and why. here you have ranks and dao marks, so
              you always know where someone sits and what got them there. mortal
              to immortal is a real qualitative change, not a bigger number, and
              inside each stage the levels are defined, so nothing feels like a
              surprise the author needed. power comes from accumulation, and the
              book respects that:{" "}
              <Spoiler k="accumulation">
                central continent should feel like thanos, because they&apos;ve
                accumulated for ages, and duke long should not be easily beaten,
                because he has lived for god knows how long as a pseudo
                venerable and designed a battle system with no apparent
                weakness, which he did.
              </Spoiler>{" "}
              you can&apos;t brute force anyone. the mc is smart, everyone is
              smart, and the fights are good to watch.
            </li>
            <li>
              the peaks.{" "}
              <Spoiler k="peaks">
                refining fixed immortal travel. taking the sovereign body. the
                perseverance arc. destroying fate gu. and the last one before
                the translation ends, the rank 9 reveal, a whole arc&apos;s
                accumulation landing in a single moment. the fate volume alone
                could have been the ending of a lesser book.
              </Spoiler>{" "}
              to give a sense of scale without spoiling anything, the second
              fate war is an infinity war level event: every faction on the
              board at once, and a finale you can feel even if you don&apos;t
              follow every piece. the peaks aren&apos;t really fights. most of
              them are mid-battle moments where the whole arc&apos;s
              accumulation lands at once. there are smaller peaks in between and
              none of them come close. i&apos;d argue they&apos;re greater than
              anything in animanga. i can&apos;t say novels in general, i
              haven&apos;t read enough, but animanga for sure.
            </li>
            <li>
              the world moves forward. it&apos;s standard world building in
              shape, tutorial village, the next town, the next region, until he
              can go anywhere, but it&apos;s done well, and new methods keep
              being discovered every era, so the past isn&apos;t automatically
              stronger than the present.
            </li>
          </ul>
        ),
      },
      {
        id: "doesnt",
        title: "what doesn't",
        body: (
          <ul>
            <li>
              a caveat first. this was my first webnovel, and i came from anime,
              manga and manhwa, which are fast. the mc leaves the tutorial area,
              his clan, around chapter 200. the solo leveling webnovel is 270
              chapters total. that&apos;s the speed difference i wasn&apos;t
              used to.
            </li>
            <li>
              the long arc in the middle.{" "}
              <Spoiler k="zombie">
                he becomes an immortal zombie and stays at the same rank for
                something like 250 chapters, until the sovereign fetus fixes
                him.
              </Spoiler>{" "}
              a lot of moving around, world building and accumulating. i still
              don&apos;t know if that&apos;s a bad thing or a necessary thing.
              the peaks need the slog to get there, and every slow part leads to
              one, so i honestly can&apos;t call it a flaw.
            </li>
            <li>
              webnovel repetition. key facts get restated so readers on the
              latest chapter don&apos;t forget them. that&apos;s the format, not
              the author, but it&apos;s there.
            </li>
            <li>
              no ending. it hasn&apos;t finished, so this can&apos;t be a full
              review. we still don&apos;t know how much is left, and the author
              hints at a lot more.
            </li>
          </ul>
        ),
      },
      {
        id: "who",
        title: "who it's for",
        body: (
          <>
            <p>
              anyone who wants cultivation done correctly. it has most of what
              you want: good characters, a good world, good fights, good peaks,
              good themes. it&apos;s why people call it one of the big three
              webnovels while it&apos;s still unfinished. if you liked the mind
              games in 18 levels or usogui, this is the same trait in a fighting
              context, with a far bigger world around it. everyone is the
              villain to fang yuan, or he&apos;s the villain to the whole world,
              and most of the cast are good in their own right.
            </p>
            <p>
              on the villain lead, since it&apos;s the thing everyone has heard.
              he is one. but it isn&apos;t the gimmick, and it isn&apos;t the
              point. the edgy parts are early, they show his nature and what
              he&apos;s capable of, and then the book moves on and you mostly
              forget about it. there really aren&apos;t that many of them.
              i&apos;m not defending him. it&apos;s who he is and how the author
              wants you to see his motivation for chasing the goal. if
              that&apos;s your reason for skipping it, it&apos;s a worse reason
              than you think.
            </p>
          </>
        ),
      },
      {
        id: "stuck",
        title: "the bit that stuck",
        body: (
          <p>
            the mc and the road he&apos;s on. watching someone ruthlessly chase
            the thing he wants against the world, against fate, against
            everything, with all the lessons of a previous life behind him. and
            the ren zu legends running beside it, so that every lesson he&apos;s
            living has already been told as a myth. the story hands you its
            meaning in pieces while it happens, not in a reveal at the end.
          </p>
        ),
      },
      {
        id: "practical",
        title: "practical",
        body: (
          <p>
            you can read it on various sites online, translation quality varies.
            it took me five months on and off, august to february, 2334
            chapters. the way i see the pacing is mountains.{" "}
            <Spoiler k="mountains">
              you start on a small one, his village, and it&apos;s slow, then
              the peak where he kills his clan and resets his talent to grade A.
              then a whole trek to the next peak, refining fixed immortal
              travel. then another stretch fixing dang mountain and so on.
            </Spoiler>{" "}
            peaks and valleys. it&apos;s the journey, and expecting every
            chapter to be dopamine is a flawed way to consume media of this
            scale. perseverance is a big theme in the book, and if you can bring
            some without it becoming a burden on your reading, you&apos;ll be
            rewarded.
          </p>
        ),
      },
      {
        id: "reread",
        title: "reread",
        body: (
          <p>
            must, and i&apos;d need to. i wrote at the fate volume that i
            couldn&apos;t give full thoughts without skimming the whole thing
            again, and that&apos;s still true. the unfinished ending
            doesn&apos;t change it. knowing where the peaks are makes the second
            read faster.
          </p>
        ),
      },
    ],
  },
];

export function getReview(slug: string): NovelReview | undefined {
  return reviews.find((r) => r.slug === slug);
}

export function reviewFor(novelEn: string): NovelReview | undefined {
  return reviews.find((r) => r.novel === novelEn);
}
