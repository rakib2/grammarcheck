import { CefrLevel } from "@/types";

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
