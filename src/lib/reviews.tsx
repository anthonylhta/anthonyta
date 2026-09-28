import type { ReactNode } from "react";

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
];

export function getReview(slug: string): NovelReview | undefined {
  return reviews.find((r) => r.slug === slug);
}

export function reviewFor(novelEn: string): NovelReview | undefined {
  return reviews.find((r) => r.novel === novelEn);
}
