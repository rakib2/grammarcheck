import { CefrLevel } from "@/types";

/**
 * One cell in a {@link GrammarTable}. The highlighted cell renders with the
 * warm-bg accent — used to draw the eye to the form the learner just got
 * wrong (e.g. "den" for masculine Akkusativ).
 */
export interface GrammarTableCell {
  value: string;
  highlight?: boolean;
}

/**
 * A small declension or conjugation table — what the brief's "/review" mock
 * shows on the right ("Why this happens"). Language-agnostic shape: each
 * language ships its own tables in its own structure list.
 */
export interface GrammarTable {
  /** Column headers (e.g. ["Mask.", "Fem.", "Neut.", "Plural"]) */
  columns: string[];
  /** Rows with a leading label and N cells matching `columns.length` */
  rows: { label: string; cells: GrammarTableCell[] }[];
}

/**
 * Master list of German grammar structures, ordered by CEFR level.
 * Each structure is a testable grammar concept the learner model tracks.
 */
export interface StructureDefinition {
  id: string;
  name: string;
  cefrLevel: CefrLevel;
  description: string;
  /** Example prompts that naturally elicit this structure */
  elicitingPrompts: string[];
  /** Common L1 interference patterns by native language */
  l1Interference: Record<string, string>;
  /**
   * Teacher-quality "why this happens" sentence for the /review page.
   * Optional — falls back to the error pattern text if missing.
   */
  whyThisHappens?: string;
  /**
   * Optional declension / conjugation table that visualises the rule.
   * Rendered on /review and (compactly) in the home right-rail sticky.
   */
  grammarTable?: GrammarTable;
}

export const GRAMMAR_STRUCTURES: StructureDefinition[] = [
  // ── A1 ──
  {
    id: "a1_word_order_svo",
    name: "Basic SVO word order",
    cefrLevel: "A1",
    description: "Subject-Verb-Object sentence structure",
    elicitingPrompts: [
      "Tell me what you do in the morning.",
      "Describe your family.",
      "What do you see in your room right now?",
    ],
    l1Interference: {
      Bengali: "Bengali uses SOV order, so you might put the verb at the end",
      Turkish: "Turkish is SOV — remember German puts the verb second",
      English: "Similar to English, so this should feel natural",
    },
    whyThisHappens:
      "In a German main clause the conjugated verb is always in second position. Anything can come first — subject, time word, object, prepositional phrase — but slot 2 is reserved for the verb.",
    grammarTable: {
      columns: ["Pos. 1", "Pos. 2 (verb)", "Rest"],
      rows: [
        { label: "subject first", cells: [{ value: "Ich" }, { value: "trinke", highlight: true }, { value: "Kaffee." }] },
        { label: "time first", cells: [{ value: "Heute" }, { value: "trinke", highlight: true }, { value: "ich Kaffee." }] },
        { label: "object first", cells: [{ value: "Kaffee" }, { value: "trinke", highlight: true }, { value: "ich." }] },
      ],
    },
  },
  {
    id: "a1_sein_haben",
    name: "sein & haben conjugation",
    cefrLevel: "A1",
    description: "Present tense forms of sein (to be) and haben (to have)",
    elicitingPrompts: [
      "Tell me about yourself — where are you from, what do you have?",
      "Describe how you're feeling today.",
      "Do you have any pets or siblings?",
    ],
    l1Interference: {
      Bengali: "Bengali doesn't conjugate 'to be' the same way — each person gets a different form in German",
      Turkish: "Turkish uses suffixes; German uses separate verb forms: bin, bist, ist...",
      English: "Similar pattern to English am/is/are",
    },
    whyThisHappens:
      "Both verbs are irregular in the present tense — every person uses a different form, so they have to be memorised rather than derived.",
    grammarTable: {
      columns: ["sein", "haben"],
      rows: [
        { label: "ich", cells: [{ value: "bin" }, { value: "habe" }] },
        { label: "du", cells: [{ value: "bist" }, { value: "hast" }] },
        { label: "er / sie / es", cells: [{ value: "ist" }, { value: "hat" }] },
        { label: "wir", cells: [{ value: "sind" }, { value: "haben" }] },
        { label: "ihr", cells: [{ value: "seid" }, { value: "habt" }] },
        { label: "sie / Sie", cells: [{ value: "sind" }, { value: "haben" }] },
      ],
    },
  },
  {
    id: "a1_articles_gender",
    name: "Nominativ articles (der/die/das)",
    cefrLevel: "A1",
    description: "Correct gender assignment and Nominativ articles",
    elicitingPrompts: [
      "Name 5 things you can see around you — use der, die, or das.",
      "What's your favorite food? Describe it.",
      "Tell me about something you bought recently.",
    ],
    l1Interference: {
      Bengali: "Bengali has no grammatical gender — you must memorize each noun's gender",
      Turkish: "Turkish has no gender — this will feel arbitrary, but patterns exist",
      English: "English dropped gender long ago — treat it like memorizing the word itself",
    },
    whyThisHappens:
      "Every German noun has a fixed gender — masculine (der), feminine (die), or neuter (das). Plurals always take die. Gender has to be memorised with each noun, not derived from the meaning.",
    grammarTable: {
      columns: ["Mask.", "Fem.", "Neut.", "Plural"],
      rows: [
        {
          label: "definite",
          cells: [{ value: "der" }, { value: "die" }, { value: "das" }, { value: "die" }],
        },
        {
          label: "indefinite",
          cells: [{ value: "ein" }, { value: "eine" }, { value: "ein" }, { value: "—" }],
        },
      ],
    },
  },
  {
    id: "a1_negation",
    name: "Negation with nicht/kein",
    cefrLevel: "A1",
    description: "When to use nicht vs kein for negation",
    elicitingPrompts: [
      "Tell me something you don't like.",
      "What don't you have in your kitchen?",
      "Describe what you didn't do today.",
    ],
    l1Interference: {
      Bengali: "Bengali uses 'na/nai' — German splits negation: kein for nouns, nicht for verbs/adjectives",
      English: "Like English not vs no — 'I have no car' = kein, 'I don't run' = nicht",
    },
    whyThisHappens:
      "German has two negators. Use kein before a noun that would otherwise take ein (or no article). Use nicht for everything else — verbs, adjectives, whole sentences. Nicht usually goes near the end.",
    grammarTable: {
      columns: ["Negates", "Position", "Example"],
      rows: [
        {
          label: "nicht",
          cells: [
            { value: "verbs / adjectives / whole clause" },
            { value: "near the end" },
            { value: "Ich tanze nicht." },
          ],
        },
        {
          label: "kein",
          cells: [
            { value: "noun w/ ein", highlight: true },
            { value: "before the noun", highlight: true },
            { value: "Ich habe kein Auto.", highlight: true },
          ],
        },
        {
          label: "kein",
          cells: [
            { value: "noun w/o article", highlight: true },
            { value: "before the noun", highlight: true },
            { value: "Ich trinke keinen Kaffee.", highlight: true },
          ],
        },
      ],
    },
  },
  {
    id: "a1_present_tense",
    name: "Regular verb conjugation (present)",
    cefrLevel: "A1",
    description: "Present tense conjugation of regular verbs",
    elicitingPrompts: [
      "What do you do every day?",
      "Describe your typical weekend.",
      "What does your best friend do for work?",
    ],
    l1Interference: {
      Bengali: "Bengali verbs change less — German adds endings: -e, -st, -t, -en",
      Turkish: "Like Turkish suffixes but different pattern: ich spiele, du spielst, er spielt",
      English: "Only -s in English (he plays), but German changes for every person",
    },
    whyThisHappens:
      "Regular verbs add a personal ending to the stem: -e (ich), -st (du), -t (er/sie/es, ihr), -en (wir, sie/Sie). The infinitive ending -en falls away first, then the endings attach.",
    grammarTable: {
      columns: ["machen", "lernen", "kommen"],
      rows: [
        { label: "ich", cells: [{ value: "mache" }, { value: "lerne" }, { value: "komme" }] },
        { label: "du", cells: [{ value: "machst" }, { value: "lernst" }, { value: "kommst" }] },
        { label: "er / sie / es", cells: [{ value: "macht" }, { value: "lernt" }, { value: "kommt" }] },
        { label: "wir", cells: [{ value: "machen" }, { value: "lernen" }, { value: "kommen" }] },
        { label: "ihr", cells: [{ value: "macht" }, { value: "lernt" }, { value: "kommt" }] },
        { label: "sie / Sie", cells: [{ value: "machen" }, { value: "lernen" }, { value: "kommen" }] },
      ],
    },
  },

  // ── A2 ──
  {
    id: "a2_akkusativ",
    name: "Akkusativ case",
    cefrLevel: "A2",
    description: "Akkusativ for direct objects — der→den, ein→einen (masculine only)",
    elicitingPrompts: [
      "What do you eat for breakfast?",
      "Tell me what you can see outside your window.",
      "Describe a person you met recently.",
    ],
    l1Interference: {
      Bengali: "Bengali doesn't change articles — but German changes der→den for masculine direct objects",
      Turkish: "Similar to Turkish accusative suffix -(y)ı — but only masculine changes in German",
      English: "English lost case — think of 'he→him': der Mann→den Mann",
    },
    whyThisHappens:
      "Akkusativ changes der → den on masculine nouns when they're the direct object. Feminine, neuter, and plural don't change.",
    grammarTable: {
      columns: ["Mask.", "Fem.", "Neut.", "Plural"],
      rows: [
        {
          label: "Nom.",
          cells: [{ value: "der" }, { value: "die" }, { value: "das" }, { value: "die" }],
        },
        {
          label: "Akk.",
          cells: [
            { value: "den", highlight: true },
            { value: "die" },
            { value: "das" },
            { value: "die" },
          ],
        },
      ],
    },
  },
  {
    id: "a2_dativ",
    name: "Dativ case",
    cefrLevel: "A2",
    description: "Dativ for indirect objects and after mit/von/zu/bei/nach/aus/seit",
    elicitingPrompts: [
      "Tell me about going somewhere with a friend.",
      "Who did you give a gift to recently?",
      "Describe how you get to work or school.",
    ],
    l1Interference: {
      Bengali: "Bengali uses postpositions that don't change nouns — German prepositions trigger Dativ",
      Turkish: "Like Turkish dative suffix -e/-a — but German changes the article: dem, der, einem",
      English: "Think 'to whom?' — mit dem Freund, von der Schule",
    },
    whyThisHappens:
      "Dativ marks the indirect object (\"to whom?\") and is forced after mit, von, zu, bei, nach, aus, seit. Masculine and neuter share dem; feminine becomes der; plural becomes den + an -n on the noun.",
    grammarTable: {
      columns: ["Mask.", "Fem.", "Neut.", "Plural"],
      rows: [
        {
          label: "Nom.",
          cells: [{ value: "der" }, { value: "die" }, { value: "das" }, { value: "die" }],
        },
        {
          label: "Dat.",
          cells: [
            { value: "dem", highlight: true },
            { value: "der", highlight: true },
            { value: "dem", highlight: true },
            { value: "den", highlight: true },
          ],
        },
      ],
    },
  },
  {
    id: "a2_perfekt",
    name: "Perfekt tense (haben/sein + Partizip II)",
    cefrLevel: "A2",
    description: "Past tense with haben/sein + ge-...-t/ge-...-en",
    elicitingPrompts: [
      "What did you do last weekend?",
      "Tell me about a trip you took.",
      "Have you ever tried a German dish?",
    ],
    l1Interference: {
      Bengali: "Bengali past is simpler — German needs two parts: 'Ich habe gespielt'",
      Turkish: "Like Turkish -dı/-mış but split: helper verb + participle at the end",
      English: "Like English 'I have played' but used for all past events in spoken German",
    },
    whyThisHappens:
      "Perfekt is the everyday past tense in spoken German. It uses haben + past participle for most verbs, and sein for verbs of motion or change of state (gehen, fahren, kommen, werden, sterben…). The participle goes to the very end of the clause.",
    grammarTable: {
      columns: ["Helper", "Past participle", "Example"],
      rows: [
        {
          label: "regular (machen)",
          cells: [{ value: "habe" }, { value: "gemacht" }, { value: "Ich habe das gemacht." }],
        },
        {
          label: "regular (spielen)",
          cells: [{ value: "habe" }, { value: "gespielt" }, { value: "Ich habe gespielt." }],
        },
        {
          label: "motion (gehen)",
          cells: [
            { value: "bin", highlight: true },
            { value: "gegangen" },
            { value: "Ich bin gegangen." },
          ],
        },
        {
          label: "motion (fahren)",
          cells: [
            { value: "bin", highlight: true },
            { value: "gefahren" },
            { value: "Ich bin gefahren." },
          ],
        },
        {
          label: "irregular (essen)",
          cells: [{ value: "habe" }, { value: "gegessen" }, { value: "Ich habe gegessen." }],
        },
      ],
    },
  },
  {
    id: "a2_modal_verbs",
    name: "Modal verbs (können, müssen, wollen, sollen, dürfen)",
    cefrLevel: "A2",
    description: "Modal verbs with infinitive at the end",
    elicitingPrompts: [
      "What can you do well?",
      "What do you have to do tomorrow?",
      "What would you like to do this weekend?",
    ],
    l1Interference: {
      Bengali: "Bengali modals don't push the main verb — German sends it to the end: Ich kann schwimmen",
      Turkish: "Similar to Turkish ability suffix — but German uses a separate word + infinitive at end",
      English: "Like 'I can swim' — but word order changes with other elements",
    },
    whyThisHappens:
      "Modal verbs share an irregular shape: ich/er-form drop the ending and the stem vowel changes. The actual main verb goes to the very end of the clause as an infinitive.",
    grammarTable: {
      columns: ["können", "müssen", "wollen", "dürfen"],
      rows: [
        { label: "ich", cells: [{ value: "kann" }, { value: "muss" }, { value: "will" }, { value: "darf" }] },
        { label: "du", cells: [{ value: "kannst" }, { value: "musst" }, { value: "willst" }, { value: "darfst" }] },
        { label: "er / sie / es", cells: [{ value: "kann" }, { value: "muss" }, { value: "will" }, { value: "darf" }] },
        { label: "wir / sie", cells: [{ value: "können" }, { value: "müssen" }, { value: "wollen" }, { value: "dürfen" }] },
      ],
    },
  },
  {
    id: "a2_prepositions_akkdativ",
    name: "Two-way prepositions (Wechselpräpositionen)",
    cefrLevel: "A2",
    description: "in, an, auf, über, unter, vor, hinter, neben, zwischen — Akkusativ for motion, Dativ for location",
    elicitingPrompts: [
      "Describe where things are in your room.",
      "Tell me where you went today and where you are now.",
      "Where did you put your keys?",
    ],
    l1Interference: {
      Bengali: "This concept doesn't exist in Bengali — motion→Akkusativ, staying→Dativ",
      Turkish: "Turkish uses different suffixes for location (-de) vs direction (-e) — same idea!",
      English: "English uses different prepositions (in vs into) — German uses same preposition, different case",
    },
    whyThisHappens:
      "Two-way prepositions take Dativ when they describe a location (\"where?\") and Akkusativ when they describe direction or motion into something (\"where to?\"). Same preposition, different case.",
    grammarTable: {
      columns: ["Question", "Case", "Article (mask.)", "Example"],
      rows: [
        {
          label: "Dativ",
          cells: [
            { value: "wo? (where)" },
            { value: "Dativ" },
            { value: "dem" },
            { value: "in dem Park" },
          ],
        },
        {
          label: "Akk.",
          cells: [
            { value: "wohin? (where to)" },
            { value: "Akk.", highlight: true },
            { value: "den", highlight: true },
            { value: "in den Park", highlight: true },
          ],
        },
      ],
    },
  },

  // ── B1 ──
  {
    id: "b1_nebensaetze",
    name: "Subordinate clauses (weil, dass, wenn, ob)",
    cefrLevel: "B1",
    description: "Verb goes to the end in subordinate clauses",
    elicitingPrompts: [
      "Why are you learning German?",
      "Tell me what you think about your city.",
      "What would you do if you had more free time?",
    ],
    l1Interference: {
      Bengali: "Bengali already puts verbs at the end — but in German, only in subordinate clauses",
      Turkish: "Turkish subordination works differently — German uses conjunctions that push verbs to end",
      English: "In English: 'because I am tired' — in German: 'weil ich müde BIN' (verb at end)",
    },
    whyThisHappens:
      "Subordinate clauses introduced by weil, dass, wenn, ob, da, obwohl, … push the conjugated verb all the way to the end of the clause. Main clauses keep the verb in second position.",
    grammarTable: {
      columns: ["Word order", "Example"],
      rows: [
        {
          label: "main clause",
          cells: [
            { value: "Subject – verb – rest" },
            { value: "Ich lese ein Buch." },
          ],
        },
        {
          label: "weil",
          cells: [
            { value: "Subj. – rest – verb (end)", highlight: true },
            { value: "…weil ich ein Buch lese.", highlight: true },
          ],
        },
        {
          label: "dass",
          cells: [
            { value: "Subj. – rest – verb (end)", highlight: true },
            { value: "…dass er Deutsch lernt.", highlight: true },
          ],
        },
        {
          label: "wenn",
          cells: [
            { value: "Subj. – rest – verb (end)", highlight: true },
            { value: "…wenn ich Zeit habe.", highlight: true },
          ],
        },
        {
          label: "ob",
          cells: [
            { value: "Subj. – rest – verb (end)", highlight: true },
            { value: "…ob das richtig ist.", highlight: true },
          ],
        },
      ],
    },
  },
  {
    id: "b1_praeteritum",
    name: "Präteritum (simple past)",
    cefrLevel: "B1",
    description: "Simple past tense, mainly for haben/sein/modal verbs and written German",
    elicitingPrompts: [
      "Tell me a story about when you were young.",
      "Describe a day from last year.",
      "Write about a historical event you find interesting.",
    ],
    l1Interference: {
      Bengali: "Bengali has a simple past form — German Präteritum is similar but mainly for writing",
      English: "Like English simple past (I went, I was) — used in writing and for haben/sein/modals in speech",
    },
    whyThisHappens:
      "Präteritum is the written past tense, but in spoken German it's reserved for sein, haben, and modal verbs. Most other verbs use Perfekt instead. The forms below are the ones you actually hear.",
    grammarTable: {
      columns: ["sein", "haben", "können", "müssen"],
      rows: [
        { label: "ich", cells: [{ value: "war" }, { value: "hatte" }, { value: "konnte" }, { value: "musste" }] },
        { label: "du", cells: [{ value: "warst" }, { value: "hattest" }, { value: "konntest" }, { value: "musstest" }] },
        { label: "er / sie / es", cells: [{ value: "war" }, { value: "hatte" }, { value: "konnte" }, { value: "musste" }] },
        { label: "wir", cells: [{ value: "waren" }, { value: "hatten" }, { value: "konnten" }, { value: "mussten" }] },
        { label: "ihr", cells: [{ value: "wart" }, { value: "hattet" }, { value: "konntet" }, { value: "musstet" }] },
        { label: "sie / Sie", cells: [{ value: "waren" }, { value: "hatten" }, { value: "konnten" }, { value: "mussten" }] },
      ],
    },
  },
  {
    id: "b1_reflexive_verbs",
    name: "Reflexive verbs (sich)",
    cefrLevel: "B1",
    description: "Verbs that require a reflexive pronoun: sich waschen, sich freuen, sich erinnern",
    elicitingPrompts: [
      "Describe your morning routine in detail.",
      "What are you looking forward to?",
      "Tell me about something you remember from childhood.",
    ],
    l1Interference: {
      Bengali: "Bengali uses 'nij/nije' for self — German attaches 'sich' (mich/dich/sich) to specific verbs",
      English: "English rarely uses reflexives — 'I wash' in English, but 'Ich wasche MICH' in German",
    },
    whyThisHappens:
      "Most reflexive verbs take the Akkusativ pronoun (Ich wasche mich). A small group take the Dativ pronoun, usually when there's another direct object — typically about parts of the body (Ich wasche mir die Hände).",
    grammarTable: {
      columns: ["Akk. (most verbs)", "Dat. (with extra object)"],
      rows: [
        { label: "ich", cells: [{ value: "mich" }, { value: "mir" }] },
        { label: "du", cells: [{ value: "dich" }, { value: "dir" }] },
        { label: "er / sie / es", cells: [{ value: "sich" }, { value: "sich" }] },
        { label: "wir", cells: [{ value: "uns" }, { value: "uns" }] },
        { label: "ihr", cells: [{ value: "euch" }, { value: "euch" }] },
        { label: "sie / Sie", cells: [{ value: "sich" }, { value: "sich" }] },
      ],
    },
  },
  {
    id: "b1_adjective_declension",
    name: "Adjective endings",
    cefrLevel: "B1",
    description: "Adjective endings depend on article type + case + gender",
    elicitingPrompts: [
      "Describe your ideal house in detail.",
      "Tell me about a good movie you watched.",
      "Describe the best meal you ever had.",
    ],
    l1Interference: {
      Bengali: "Bengali adjectives don't change — German adjectives get endings based on case/gender/article",
      English: "English adjectives never change — this is completely new and takes practice",
    },
    whyThisHappens:
      "After der/die/das, adjectives take just two endings: -e in the nominative singular and feminine/neuter accusative, -en everywhere else. The article does the heavy lifting for case, so the adjective stays simple.",
    grammarTable: {
      columns: ["Mask.", "Fem.", "Neut.", "Plural"],
      rows: [
        { label: "Nom.", cells: [{ value: "der gute Mann" }, { value: "die gute Frau" }, { value: "das gute Kind" }, { value: "die guten Leute" }] },
        { label: "Akk.", cells: [{ value: "den guten Mann", highlight: true }, { value: "die gute Frau" }, { value: "das gute Kind" }, { value: "die guten Leute" }] },
        { label: "Dat.", cells: [{ value: "dem guten Mann", highlight: true }, { value: "der guten Frau", highlight: true }, { value: "dem guten Kind", highlight: true }, { value: "den guten Leuten", highlight: true }] },
      ],
    },
  },
  {
    id: "b1_konjunktiv2",
    name: "Konjunktiv II (würde + Infinitiv)",
    cefrLevel: "B1",
    description: "Subjunctive for wishes, polite requests, hypotheticals",
    elicitingPrompts: [
      "If you could live anywhere, where would you live?",
      "What would you change about your city?",
      "How would you politely ask for help in German?",
    ],
    l1Interference: {
      Bengali: "Bengali conditional uses 'jodi...tobe' — German uses würde + infinitive or hätte/wäre",
      Turkish: "Like Turkish -se/-sa conditional — German: Wenn ich reich wäre, würde ich reisen",
      English: "Like 'would + verb' — Ich würde reisen = I would travel",
    },
    whyThisHappens:
      "Konjunktiv II expresses wishes, polite requests, and hypotheticals (would / could / had). For sein, haben, and the modals you use the special past forms with umlaut. For everything else, würde + infinitive is the everyday workaround.",
    grammarTable: {
      columns: ["sein", "haben", "können", "würde + Inf."],
      rows: [
        { label: "ich", cells: [{ value: "wäre" }, { value: "hätte" }, { value: "könnte" }, { value: "würde gehen" }] },
        { label: "du", cells: [{ value: "wärst" }, { value: "hättest" }, { value: "könntest" }, { value: "würdest gehen" }] },
        { label: "er / sie / es", cells: [{ value: "wäre" }, { value: "hätte" }, { value: "könnte" }, { value: "würde gehen" }] },
        { label: "wir", cells: [{ value: "wären" }, { value: "hätten" }, { value: "könnten" }, { value: "würden gehen" }] },
        { label: "ihr", cells: [{ value: "wärt" }, { value: "hättet" }, { value: "könntet" }, { value: "würdet gehen" }] },
        { label: "sie / Sie", cells: [{ value: "wären" }, { value: "hätten" }, { value: "könnten" }, { value: "würden gehen" }] },
      ],
    },
  },

  // ── B2 ──
  {
    id: "b2_passiv",
    name: "Passive voice (werden + Partizip II)",
    cefrLevel: "B2",
    description: "Passive constructions: Das Buch wird gelesen",
    elicitingPrompts: [
      "Describe how something is made — a dish, a product.",
      "Tell me about a building that was built in your city.",
      "What languages are spoken in your country?",
    ],
    l1Interference: {
      Bengali: "Bengali passive is rare — German uses it frequently: werden + past participle",
      English: "Like English 'is being read' — but German uses werden: wird gelesen",
    },
    whyThisHappens:
      "German passives use werden plus the past participle. The participle goes to the very end of the clause. Tense is shown on werden — wird (now), wurde (then), ist worden (perfect).",
    grammarTable: {
      columns: ["werden form", "Partizip II", "Example"],
      rows: [
        { label: "present", cells: [{ value: "wird", highlight: true }, { value: "geöffnet" }, { value: "Die Tür wird geöffnet." }] },
        { label: "past", cells: [{ value: "wurde", highlight: true }, { value: "geöffnet" }, { value: "Die Tür wurde geöffnet." }] },
        { label: "perfect", cells: [{ value: "ist … worden", highlight: true }, { value: "geöffnet" }, { value: "Die Tür ist geöffnet worden." }] },
        { label: "modal", cells: [{ value: "muss … werden", highlight: true }, { value: "geöffnet" }, { value: "Die Tür muss geöffnet werden." }] },
      ],
    },
  },
  {
    id: "b2_genitiv",
    name: "Genitiv case",
    cefrLevel: "B2",
    description: "Possession and formal prepositions: des, der, eines, einer + (e)s on masculine/neuter nouns",
    elicitingPrompts: [
      "Describe the meaning of a word or concept.",
      "Talk about someone's opinion or someone's house.",
      "Despite something, what happened?",
    ],
    l1Interference: {
      Bengali: "Bengali uses -er/-r for possession — German uses des/der + noun ending",
      English: "Like English 's or 'of' — des Mannes = of the man / the man's",
    },
    whyThisHappens:
      "Genitiv shows possession (des Mannes Hut) and follows certain prepositions (wegen, trotz, während, statt). Masculine and neuter nouns also add -(e)s to the noun itself. Feminine and plural nouns stay unchanged — only the article moves.",
    grammarTable: {
      columns: ["Mask.", "Fem.", "Neut.", "Plural"],
      rows: [
        { label: "Nom.", cells: [{ value: "der" }, { value: "die" }, { value: "das" }, { value: "die" }] },
        {
          label: "Gen.",
          cells: [
            { value: "des -(e)s", highlight: true },
            { value: "der", highlight: true },
            { value: "des -(e)s", highlight: true },
            { value: "der", highlight: true },
          ],
        },
      ],
    },
  },
  {
    id: "b2_relative_clauses",
    name: "Relative clauses (der/die/das als Relativpronomen)",
    cefrLevel: "B2",
    description: "Clauses that describe a noun: Der Mann, der dort steht, ist mein Lehrer",
    elicitingPrompts: [
      "Describe a person you admire — use 'who' clauses.",
      "Tell me about a place that you love.",
      "Describe a book that changed your thinking.",
    ],
    l1Interference: {
      Bengali: "Bengali uses 'je/jini' for relatives — German uses der/die/das matching the noun's gender",
      English: "Like 'who/which/that' — but German relative pronouns change by gender AND case",
    },
    whyThisHappens:
      "Relative pronouns look like the definite article — except in Dativ plural (denen) and the whole Genitiv row (dessen, deren). The pronoun's gender matches the noun it refers to; its case is determined by the relative clause itself.",
    grammarTable: {
      columns: ["Mask.", "Fem.", "Neut.", "Plural"],
      rows: [
        { label: "Nom.", cells: [{ value: "der" }, { value: "die" }, { value: "das" }, { value: "die" }] },
        { label: "Akk.", cells: [{ value: "den" }, { value: "die" }, { value: "das" }, { value: "die" }] },
        { label: "Dat.", cells: [{ value: "dem" }, { value: "der" }, { value: "dem" }, { value: "denen", highlight: true }] },
        {
          label: "Gen.",
          cells: [
            { value: "dessen", highlight: true },
            { value: "deren", highlight: true },
            { value: "dessen", highlight: true },
            { value: "deren", highlight: true },
          ],
        },
      ],
    },
  },
  {
    id: "b2_konjunktiv1",
    name: "Konjunktiv I (indirect speech)",
    cefrLevel: "B2",
    description: "Reporting what someone said: Er sagte, er sei müde",
    elicitingPrompts: [
      "Tell me what someone told you recently.",
      "Summarize a news article you read.",
      "What does your friend think about learning languages?",
    ],
    l1Interference: {
      Bengali: "Bengali uses 'bole' for reported speech — German changes the verb form: sei, habe, könne",
      English: "English barely marks this — German changes verb form to show you're reporting, not asserting",
    },
    whyThisHappens:
      "Konjunktiv I marks reported speech — when you're saying what someone else said without taking responsibility for it. It's mostly used in 3rd person (sei, habe, könne) and almost only in writing or news. If the form clashes with the indicative, speakers fall back to Konjunktiv II.",
    grammarTable: {
      columns: ["sein", "haben", "können", "sagen"],
      rows: [
        { label: "ich", cells: [{ value: "sei" }, { value: "habe" }, { value: "könne" }, { value: "sage" }] },
        {
          label: "er / sie / es",
          cells: [
            { value: "sei", highlight: true },
            { value: "habe", highlight: true },
            { value: "könne", highlight: true },
            { value: "sage", highlight: true },
          ],
        },
        { label: "wir", cells: [{ value: "seien" }, { value: "haben" }, { value: "können" }, { value: "sagen" }] },
        { label: "sie / Sie", cells: [{ value: "seien" }, { value: "haben" }, { value: "können" }, { value: "sagen" }] },
      ],
    },
  },

  // ── C1 ──
  {
    id: "c1_partizip_constructions",
    name: "Extended participial constructions",
    cefrLevel: "C1",
    description: "Complex noun phrases with participles: der auf dem Tisch liegende Brief",
    elicitingPrompts: [
      "Describe a scene in very precise detail.",
      "Rewrite this simple sentence in a more literary style.",
      "Describe a process using formal language.",
    ],
    l1Interference: {
      Bengali: "Bengali uses similar pre-noun modifiers — this may feel natural",
      English: "English uses post-noun relatives ('the letter lying on the table') — German puts it before the noun",
    },
    whyThisHappens:
      "Instead of trailing relative clauses, written German often packs the whole modifier in front of the noun, using a participle. The phrase between the article and the noun can grow long; everything inside it modifies the noun.",
    grammarTable: {
      columns: ["Type", "Pattern", "Example"],
      rows: [
        {
          label: "Präsens-Partizip",
          cells: [
            { value: "stem + -end" },
            { value: "der ⟨…⟩ -ende [Noun]" },
            { value: "das lachende Kind" },
          ],
        },
        {
          label: "Perfekt-Partizip",
          cells: [
            { value: "ge- + -t / -en" },
            { value: "das ⟨…⟩ -ge…te [Noun]" },
            { value: "das gelesene Buch" },
          ],
        },
        {
          label: "extended phrase",
          cells: [
            { value: "+ adverbials inside", highlight: true },
            { value: "der auf dem Tisch liegende Brief", highlight: true },
            { value: "= the letter lying on the table", highlight: true },
          ],
        },
      ],
    },
  },
  {
    id: "c1_modal_particles",
    name: "Modal particles (doch, ja, mal, eben, halt, wohl)",
    cefrLevel: "C1",
    description: "Small words that add nuance, attitude, and naturalness to speech",
    elicitingPrompts: [
      "Try to convince me to do something.",
      "Express surprise about something.",
      "Make a casual suggestion to a friend.",
    ],
    l1Interference: {
      Bengali: "Bengali has similar discourse particles (to, na, ki) — German ones work the same way!",
      English: "English has no direct equivalent — these add 'flavor' and native-like feel",
    },
    whyThisHappens:
      "Modal particles are little words that don't translate but signal attitude — surprise, softening, shared knowledge, resignation. They sit unstressed in the middle of the sentence. Using them is the difference between correct German and natural German.",
    grammarTable: {
      columns: ["Particle", "Function", "Example"],
      rows: [
        { label: "mal", cells: [{ value: "softens command" }, { value: "Komm mal her." }, { value: "Come here (please)." }] },
        { label: "doch", cells: [{ value: "expresses surprise / contrast" }, { value: "Du kommst doch?" }, { value: "You're still coming, right?" }] },
        { label: "ja", cells: [{ value: "shared knowledge" }, { value: "Du weißt ja, dass …" }, { value: "As you know, …" }] },
        { label: "halt / eben", cells: [{ value: "resignation" }, { value: "Das ist halt so." }, { value: "It is what it is." }] },
        { label: "wohl", cells: [{ value: "presumption" }, { value: "Das wird wohl stimmen." }, { value: "That's probably true." }] },
      ],
    },
  },

  // ── C2 ──
  {
    id: "c2_funktionsverbgefuege",
    name: "Funktionsverbgefüge (function verb constructions)",
    cefrLevel: "C2",
    description: "Formal constructions: in Betracht ziehen, zur Verfügung stellen, Einfluss nehmen",
    elicitingPrompts: [
      "Discuss a complex topic using formal language.",
      "Write as if composing a business email.",
      "Explain a process in academic style.",
    ],
    l1Interference: {
      Bengali: "Bengali uses similar light verb constructions — this pattern may feel familiar",
      English: "Like 'take into consideration' instead of 'consider' — German has many of these in formal writing",
    },
    whyThisHappens:
      "Funktionsverbgefüge are formal collocations: a noun carries the meaning, a \"light verb\" (machen, nehmen, stellen, treten, kommen) carries the grammar. They sound bureaucratic in plain speech but are everywhere in business writing, legal language, and journalism.",
    grammarTable: {
      columns: ["Construction", "Plain verb", "Register"],
      rows: [
        { label: "in Anspruch nehmen", cells: [{ value: "nutzen" }, { value: "Er nimmt Hilfe in Anspruch." }, { value: "formal" }] },
        { label: "zur Verfügung stellen", cells: [{ value: "geben" }, { value: "Wir stellen Geld zur Verfügung." }, { value: "formal" }] },
        { label: "in Kraft treten", cells: [{ value: "gelten" }, { value: "Das Gesetz tritt in Kraft." }, { value: "legal" }] },
        { label: "Einfluss nehmen", cells: [{ value: "beeinflussen" }, { value: "Die Politik nimmt Einfluss." }, { value: "formal" }] },
        { label: "in Betracht ziehen", cells: [{ value: "erwägen" }, { value: "Wir ziehen das in Betracht." }, { value: "formal" }] },
      ],
    },
  },
  {
    id: "c2_academic_register",
    name: "Academic/formal register",
    cefrLevel: "C2",
    description: "Complex sentence structures, nominalization, formal connectors used in academic German",
    elicitingPrompts: [
      "Write a paragraph arguing for or against something.",
      "Summarize a research finding in formal German.",
      "Write an introduction for an essay.",
    ],
    l1Interference: {
      Bengali: "Bengali academic writing is also highly nominalized — German is similar",
      English: "Like moving from casual to academic English — more nouns, fewer verbs, formal connectors",
    },
    whyThisHappens:
      "Academic German leans on nominalization (verbs becoming -ung nouns), passive voice, formal connectors, and impersonal constructions. The casual phrasing isn't wrong — it just signals the wrong register. Choose the right column for the right context.",
    grammarTable: {
      columns: ["Casual", "Academic"],
      rows: [
        { label: "I think that …", cells: [{ value: "Ich denke, dass …" }, { value: "Es ist davon auszugehen, dass …", highlight: true }] },
        { label: "We can see that …", cells: [{ value: "Wir sehen, dass …" }, { value: "Es lässt sich feststellen, dass …", highlight: true }] },
        { label: "X is important", cells: [{ value: "X ist wichtig." }, { value: "X ist von Bedeutung.", highlight: true }] },
        { label: "X causes Y", cells: [{ value: "X verursacht Y." }, { value: "X führt zu Y.", highlight: true }] },
        { label: "because", cells: [{ value: "weil" }, { value: "da / aufgrund / infolge", highlight: true }] },
      ],
    },
  },
];

/** Get structures for a specific CEFR level */
export function getStructuresForLevel(level: CefrLevel): StructureDefinition[] {
  return GRAMMAR_STRUCTURES.filter((s) => s.cefrLevel === level);
}

/** Get structures up to and including a level */
export function getStructuresUpToLevel(level: CefrLevel): StructureDefinition[] {
  const order: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const idx = order.indexOf(level);
  return GRAMMAR_STRUCTURES.filter((s) => order.indexOf(s.cefrLevel) <= idx);
}

/** Find a structure by ID */
export function getStructureById(id: string): StructureDefinition | undefined {
  return GRAMMAR_STRUCTURES.find((s) => s.id === id);
}
