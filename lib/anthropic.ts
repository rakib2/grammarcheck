import Anthropic from "@anthropic-ai/sdk";
import { GrammarAnalysis, CefrLevel } from "@/types";
import { GRAMMAR_STRUCTURES } from "./grammarStructures";
import { APIAnalysisResult } from "./conversationEngine";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/** Strip markdown code fences and parse JSON safely */
function safeParseJSON<T>(text: string): T {
  let cleaned = text.trim();
  // Remove ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const extracted = extractFirstJSONObject(cleaned);
    if (extracted) return JSON.parse(extracted);
    throw err;
  }
}

function extractFirstJSONObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

export interface AnalysisWithLevel extends GrammarAnalysis {
  detectedLevel: CefrLevel;
  nextPrompt: string;
}

// ── Simple analysis (used by legacy /api/grammar for basic mode) ──

export async function analyzeGrammar(
  sentence: string,
  targetTopic: string,
  nativeLanguage: string
): Promise<GrammarAnalysis> {
  const result = await analyzeGrammarFull(sentence, targetTopic, nativeLanguage);
  return result;
}

export async function analyzeGrammarFull(
  sentence: string,
  targetTopic: string | null,
  nativeLanguage: string
): Promise<AnalysisWithLevel> {
  const topicInstruction = targetTopic
    ? `The grammar topic to focus on is "${targetTopic}".`
    : `Auto-detect the grammar topic from the sentence.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: `You are a warm, patient German conversation partner helping someone practice. The user's native language is ${nativeLanguage}. ${topicInstruction}

Analyze the given German sentence and return ONLY valid JSON (no markdown fences):
{
  "tokens": [
    {
      "word": "string",
      "status": "correct" | "wrong" | "warn" | "tip",
      "correction": "string (optional, only if wrong or warn)",
      "rule": "string (optional, brief friendly rule — relate to ${nativeLanguage} if helpful)"
    }
  ],
  "score": number between 0 and 100,
  "errorTypes": ["array of grammar error category strings"],
  "coachMessage": "Your warm, conversational response. React to what they SAID first, then fold in grammar feedback naturally. Sound like a real person, not a teacher grading homework. 2-3 sentences.",
  "detectedLevel": "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
  "nextPrompt": "A genuinely curious follow-up question — something you'd actually ask a friend. Gently steer toward grammar they need to practice."
}

Rules:
- Each word must appear as a token
- "correct": grammatically correct
- "wrong": clear grammatical error (provide correction)
- "warn": acceptable but could be better (provide correction)
- "tip": chance to teach something related
- coachMessage: respond to the MEANING first, then corrections — like a friend, not a textbook
- Never start with "Great job!" or "Good effort!" — that's teacher-talk
- nextPrompt: make it feel like a real conversation, not a test`,
    messages: [
      {
        role: "user",
        content: `Analyze this sentence: "${sentence}"`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Anthropic API");
  }

  return safeParseJSON(content.text);
}

// ── Structure-aware analysis (used by the ACL conversation engine) ──

const STRUCTURE_IDS = GRAMMAR_STRUCTURES.map((s) => s.id);

export interface LearnerContext {
  nativeLanguage: string;
  coachLanguage: string;     // language the coach should respond in
  sessionCount: number;
  totalTurns: number;
  detectedLevel: string;
  improving: string[];       // structure names trending up
  struggling: string[];      // structure names with low mastery
  recentErrors: string[];    // last few error patterns (e.g., "Dativ: mein → meinem")
  focusDrilling?: string;    // structure name being drilled (stay on this topic)
  persistentErrors?: string[];  // cross-session: structures with repeated errors across sessions
  sessionFocus?: string[];      // cross-session: recommended topics for this session
}

// ── Model selection: Haiku for simple, Sonnet for complex ──

export function selectModel(
  learnerContext?: LearnerContext,
  opts: { preferFast?: boolean } = {}
): string {
  // Voice path forces Haiku — latency matters more than nuance, and Vercel
  // function timeouts kill the voice UI if Claude takes too long.
  if (opts.preferFast) return "claude-haiku-4-5-20251001";

  if (!learnerContext) return "claude-sonnet-4-20250514";

  // Use fast Haiku when learner is doing well
  const isSimple =
    learnerContext.struggling.length === 0 &&
    learnerContext.recentErrors.length <= 1;

  return isSimple ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-20250514";
}

// ── Build the system prompt (shared between streaming and non-streaming) ──

function buildConversationPrompt(
  nativeLanguage: string,
  targetStructureId: string | null,
  learnerContext?: LearnerContext
): string {
  const targetDef = targetStructureId ? GRAMMAR_STRUCTURES.find(s => s.id === targetStructureId) : null;
  const targetHint = targetDef
    ? `The conversation is currently targeting: "${targetDef.name}" (${targetDef.description}). Your nextPrompt MUST naturally elicit this structure — ask something that requires the learner to use ${targetDef.name} in their answer.`
    : targetStructureId
    ? `The conversation is currently targeting the grammar structure "${targetStructureId}". Pay special attention to this.`
    : "";

  const structureList = STRUCTURE_IDS.join(", ");

  let learnerSummary = "";
  if (learnerContext) {
    const parts: string[] = [];
    if (learnerContext.sessionCount <= 1) {
      parts.push("This is their first or second session — be extra welcoming and patient.");
    } else {
      parts.push(`They've had ${learnerContext.sessionCount} sessions and practiced ${learnerContext.totalTurns} sentences.`);
    }
    if (learnerContext.improving.length > 0) {
      parts.push(`Getting better at: ${learnerContext.improving.join(", ")}. Acknowledge this naturally when relevant.`);
    }
    if (learnerContext.struggling.length > 0) {
      parts.push(`Still working on: ${learnerContext.struggling.join(", ")}. Be gentle, they're trying.`);
    }
    if (learnerContext.recentErrors.length > 0) {
      parts.push(`Recent mistakes: ${learnerContext.recentErrors.join("; ")}`);
    }
    if (learnerContext.focusDrilling) {
      parts.push(`DRILLING MODE: The learner just made an error with "${learnerContext.focusDrilling}". Your nextPrompt MUST require them to use this grammar point again. Stay on this topic until they get it right. Give them a slightly different sentence to practice the same pattern.`);
    }
    if (learnerContext.persistentErrors && learnerContext.persistentErrors.length > 0) {
      parts.push(`CROSS-SESSION PATTERN: These grammar points have been problematic across multiple sessions: ${learnerContext.persistentErrors.join(", ")}. Weave these into your prompts when natural. Be encouraging — they're persistent challenges, not failures.`);
    }
    if (learnerContext.sessionFocus && learnerContext.sessionFocus.length > 0) {
      parts.push(`TODAY'S FOCUS: The system recommends focusing on: ${learnerContext.sessionFocus.join(", ")}. Steer your nextPrompt toward these topics when possible.`);
    }
    learnerSummary = `\n\nAbout this learner:\n${parts.join("\n")}`;
  }

  const coachLang = learnerContext?.coachLanguage ?? nativeLanguage;

  return `You are a skilled German language tutor having a spoken conversation with your student. You are warm but focused on actually teaching. Think of the best language tutor you've ever had — someone who listens, but whose primary job is helping you improve.

The learner's native language is ${nativeLanguage}. Their current level is roughly ${learnerContext?.detectedLevel ?? "A1"}.
${targetHint}
${learnerSummary}

RESPONSE LANGUAGE — ABSOLUTE RULE:
- Write your coachMessage in **${coachLang}**. NO EXCEPTIONS.
- Write your nextPrompt ALSO in **${coachLang}**. The nextPrompt is NOT metadata — it is the question the learner reads on screen. Do NOT default to English. If ${coachLang} is Bengali, the nextPrompt is in Bengali. If ${coachLang} is Turkish, it's in Turkish.
- The learner is practicing German, so they will write German to you. You do NOT mirror their language — you respond in ${coachLang}.
- Grammar terms ("Dativ", "Akkusativ", "Nominativ") stay as German words. Quote corrected German sentences as German ("It should be 'mit meinem Freund'"). But the framing and explanation around them are in ${coachLang}.
- Do NOT drift into English or German just because those words appear in the sentence you're analyzing. Stay in ${coachLang}.
- Switch language ONLY if the learner explicitly asks in-message (e.g. "answer in Bengali", "auf Deutsch erklären"). Otherwise stay in ${coachLang} every single turn.

HOW TO RESPOND — think like a human tutor in a 1-on-1 lesson:

CRITICAL LENGTH RULE: The coachMessage must be SHORT — 2 to 3 sentences total. It is spoken aloud to the learner; long coachMessages get truncated by the voice model and bore the learner. Pick the SINGLE most important correction and teach it. You can address other errors in future turns.

1. ACKNOWLEDGE what they said (1 short sentence) — optional if short on space.
2. IF ERRORS: TEACH the #1 most important correction:
   - Say the correct form clearly and WRAP IT IN MARKDOWN BOLD: **'mit meinem Freund'** — after 'mit' we use Dativ.
   - One-sentence explanation. No textbook paragraphs.
3. IF NO ERRORS: Acknowledge warmly (1 sentence) and note what they did well.
4. DO NOT end the coachMessage with a follow-up question. The nextPrompt field is the ONLY follow-up. If you add a question to coachMessage, the learner gets TWO different questions, which is broken UX.

FORMATTING inside coachMessage:
- Wrap every corrected/quoted German form in markdown bold: **'mit meinem Freund'**, **'meinem'**, **'Ich habe gegessen'**. This makes the correct forms visually stand out on screen.
- Do NOT use bold for anything else — only the German corrections.

SPEECH INPUT: The learner is speaking (not typing). Their input may contain:
- Self-corrections: "Ich habe... nein, Ich bin gegangen" — analyze only the FINAL intended version, ignore the corrected part. Self-correction is a GOOD sign.
- Hesitations, filler words, restarts — focus on what they meant to say
- Imperfect transcription — be generous in interpretation

TEACHING PHILOSOPHY:
- Explain grammar clearly on the FIRST error. Don't be subtle. A recast that the learner misses teaches nothing.
- Use ${nativeLanguage} comparisons when helpful: "In ${nativeLanguage} you'd say X, but in German..."
- When they repeat an error they've made before, go DEEPER: explain the underlying pattern, give 2-3 examples, make them practice it
- Stay on one grammar topic until they get it. Don't jump around.
- If they get something right that they previously struggled with, celebrate it specifically
- Speak at their level. A1 = very simple ${coachLang}. B2 = more complex.

Known grammar structure IDs: [${structureList}]

RESPONSE FORMAT — you MUST follow this exact format:

1. First, write your tutor response as PLAIN TEXT (no JSON). This is spoken aloud to the learner. Keep it natural, warm, but educational. 2-5 sentences.

2. Then write this exact delimiter on its own line:
<<<ANALYSIS>>>

3. Then write the structured JSON analysis (no markdown fences):
{
  "tokens": [
    { "word": "string", "status": "correct"|"wrong"|"warn"|"tip", "correction": "optional string", "rule": "optional string — a clear, spoken explanation, not jargon" }
  ],
  "score": 0-100,
  "errorTypes": ["string"],
  "detectedLevel": "A1"|"A2"|"B1"|"B2"|"C1"|"C2",
  "structuresUsed": ["structure_id", ...],
  "errors": [
    {
      "structureId": "one of the known structure IDs",
      "original": "the incorrect word/phrase",
      "correction": "the correct form",
      "rule": "clear spoken explanation of WHY this is wrong and how to remember it",
      "ruleForL1": "comparison to ${nativeLanguage} — how does this work differently in their language?"
    }
  ],
  "nextPrompt": "The SINGLE follow-up question for the learner. MUST be written in ${coachLang} (NOT English, NOT German — unless ${coachLang} IS English or German). CRITICAL: If there were errors, this question MUST target the SAME grammar structure so the learner practices it again. Make it feel natural but ensure they need to use that grammar point. If no errors, continue the conversation naturally. NEVER repeat a question from the conversation. This is the ONLY question the learner sees — do NOT also put a question in the coachMessage."
}

CRITICAL RULES:
- Your response will be READ ALOUD via text-to-speech. Write like you're speaking, not writing.
- The ONLY markdown you should use is **bold** around corrected German forms (see FORMATTING rule above). No bullet points, no headers, no italics — those sound weird when spoken aloud.
- Don't say "Great job!" or "Good effort!" — instead be specific: "You got the word order right this time, nice"
- If the sentence is perfect, say so briefly and ask something more challenging
- Be direct about errors. "You said X but it should be Y because Z." Clear teaching beats subtle hints.
- Keep the grammar explanation inside the spoken response, not just in the JSON. The user HEARS your response.`;
}

function buildMessages(
  sentence: string,
  conversationContext: string,
  coachLanguage?: string
): { role: "user" | "assistant"; content: string }[] {
  // Per-turn language reminder at the user-message level. System-level
  // instructions get softened by long conversations; message-level
  // reinforcement keeps the response locked to the chosen language,
  // especially on smaller/faster models (Haiku) used in the voice path.
  const langReminder = coachLanguage
    ? `\n\nREMINDER — language for your reply: write your coachMessage and nextPrompt in **${coachLanguage}**. Do not use any other language. Quote German words as German, but the framing is in ${coachLanguage}.`
    : "";

  return [
    ...(conversationContext
      ? [{ role: "user" as const, content: `Previous conversation:\n${conversationContext}` },
         { role: "assistant" as const, content: "Got it, continuing the conversation." }]
      : []),
    {
      role: "user" as const,
      content: `Analyze this sentence: "${sentence}"${langReminder}`,
    },
  ];
}

// ── Streaming analysis (used by the streaming converse endpoint) ──

export async function* streamAnalyzeForConversation(
  sentence: string,
  nativeLanguage: string,
  targetStructureId: string | null,
  conversationContext: string,
  learnerContext?: LearnerContext
): AsyncGenerator<{ type: "token"; text: string } | { type: "coachDone"; text: string } | { type: "analysis"; data: APIAnalysisResult }> {
  const model = selectModel(learnerContext);
  const systemPrompt = buildConversationPrompt(nativeLanguage, targetStructureId, learnerContext);
  const messages = buildMessages(sentence, conversationContext, learnerContext?.coachLanguage);

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages,
  });

  let fullText = "";
  let delimiterFound = false;
  let coachMessage = "";

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      const chunk = event.delta.text;
      fullText += chunk;

      if (!delimiterFound) {
        // Check if delimiter appeared
        const delimIdx = fullText.indexOf("<<<ANALYSIS>>>");
        if (delimIdx !== -1) {
          delimiterFound = true;
          // Emit any remaining coach text before delimiter
          const remaining = fullText.slice(0, delimIdx).slice(coachMessage.length).trim();
          if (remaining) {
            yield { type: "token", text: remaining };
          }
          coachMessage = fullText.slice(0, delimIdx).trim();
          yield { type: "coachDone", text: coachMessage };
        } else {
          // Stream coach message tokens — but hold back last 20 chars in case delimiter is split
          const safe = fullText.slice(0, Math.max(0, fullText.length - 20));
          const newText = safe.slice(coachMessage.length);
          if (newText) {
            coachMessage = safe;
            yield { type: "token", text: newText };
          }
        }
      }
      // After delimiter, just accumulate (JSON part)
    }
  }

  // Parse the full response
  const delimIdx = fullText.indexOf("<<<ANALYSIS>>>");
  if (delimIdx !== -1) {
    if (!delimiterFound) {
      // Delimiter was in the held-back buffer
      coachMessage = fullText.slice(0, delimIdx).trim();
      yield { type: "coachDone", text: coachMessage };
    }
    const jsonPart = fullText.slice(delimIdx + "<<<ANALYSIS>>>".length).trim();
    try {
      const analysis = safeParseJSON<Omit<APIAnalysisResult, "coachMessage">>(jsonPart);
      yield {
        type: "analysis",
        data: { ...analysis, coachMessage } as APIAnalysisResult,
      };
    } catch (e) {
      console.error("Failed to parse analysis JSON:", e, "\nRaw:", jsonPart);
      // Fallback: return minimal analysis with just the coach message
      yield {
        type: "analysis",
        data: {
          tokens: [],
          score: 70,
          errorTypes: [],
          detectedLevel: (learnerContext?.detectedLevel ?? "A1") as CefrLevel,
          structuresUsed: [],
          errors: [],
          coachMessage,
          nextPrompt: "",
        },
      };
    }
  } else {
    // No delimiter found — try parsing entire response as JSON (fallback to old format)
    console.warn("No <<<ANALYSIS>>> delimiter found, trying JSON fallback");
    try {
      const result = safeParseJSON<APIAnalysisResult>(fullText);
      yield { type: "coachDone", text: result.coachMessage };
      yield { type: "analysis", data: result };
    } catch {
      yield { type: "coachDone", text: fullText.trim() };
      yield {
        type: "analysis",
        data: {
          tokens: [],
          score: 70,
          errorTypes: [],
          detectedLevel: (learnerContext?.detectedLevel ?? "A1") as CefrLevel,
          structuresUsed: [],
          errors: [],
          coachMessage: fullText.trim(),
          nextPrompt: "",
        },
      };
    }
  }
}

// ── Non-streaming version (kept for backward compatibility / deep practice) ──

export async function analyzeForConversation(
  sentence: string,
  nativeLanguage: string,
  targetStructureId: string | null,
  conversationContext: string,
  learnerContext?: LearnerContext,
  opts: { preferFast?: boolean } = {}
): Promise<APIAnalysisResult> {
  const model = selectModel(learnerContext, opts);
  const systemPrompt = buildConversationPrompt(nativeLanguage, targetStructureId, learnerContext);
  const messages = buildMessages(sentence, conversationContext, learnerContext?.coachLanguage);

  const message = await anthropic.messages.create({
    model,
    max_tokens: opts.preferFast ? 3000 : 2200,
    system: systemPrompt,
    messages,
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Anthropic API");
  }

  const text = content.text;
  const fallbackLevel = (learnerContext?.detectedLevel ?? "A1") as CefrLevel;

  // Happy path: two-part format with <<<ANALYSIS>>> delimiter
  const delimIdx = text.indexOf("<<<ANALYSIS>>>");
  if (delimIdx !== -1) {
    const coachMessage = text.slice(0, delimIdx).trim();
    const jsonPart = text.slice(delimIdx + "<<<ANALYSIS>>>".length).trim();
    try {
      const analysis = safeParseJSON<Omit<APIAnalysisResult, "coachMessage">>(jsonPart);
      return { ...analysis, coachMessage } as APIAnalysisResult;
    } catch (err) {
      // Parse failed — log raw response so we can see what Claude returned
      // in Vercel logs, and degrade gracefully so the caller (voice tool
      // path) still surfaces the coach message to the learner.
      console.warn(
        "[anthropic] analysis JSON parse failed, using coachMessage-only fallback:",
        err instanceof Error ? err.message : String(err),
        "\nRaw JSON part:",
        jsonPart.slice(0, 500)
      );
      return {
        tokens: [],
        score: 70,
        errorTypes: [],
        detectedLevel: fallbackLevel,
        structuresUsed: [],
        errors: [],
        coachMessage,
        nextPrompt: "",
      };
    }
  }

  // Legacy/pure-JSON path
  try {
    return safeParseJSON(text);
  } catch (err) {
    console.warn(
      "[anthropic] pure-JSON parse failed, using plain-text fallback:",
      err instanceof Error ? err.message : String(err),
      "\nRaw response:",
      text.slice(0, 500)
    );
    return {
      tokens: [],
      score: 70,
      errorTypes: [],
      detectedLevel: fallbackLevel,
      structuresUsed: [],
      errors: [],
      coachMessage: text.trim(),
      nextPrompt: "",
    };
  }
}
