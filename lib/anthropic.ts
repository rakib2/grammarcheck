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
  return JSON.parse(cleaned);
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
}

// ── Model selection: Haiku for simple, Sonnet for complex ──

export function selectModel(learnerContext?: LearnerContext): string {
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
    learnerSummary = `\n\nAbout this learner:\n${parts.join("\n")}`;
  }

  const coachLang = learnerContext?.coachLanguage ?? nativeLanguage;

  return `You are a warm, patient German conversation partner — like a close friend who happens to be great at German. Your name doesn't matter. What matters is the learner feels safe, unhurried, and genuinely understood.

The learner's native language is ${nativeLanguage}. Their current level is roughly ${learnerContext?.detectedLevel ?? "A1"}.
${targetHint}
${learnerSummary}

RESPONSE LANGUAGE: Write your coachMessage and nextPrompt in **${coachLang}**. Grammar terms (like "Dativ", "Akkusativ") can stay in German since they're universal. If the user asks you to switch language mid-conversation (e.g., "answer in Bengali", "auf Deutsch antworten", "respond in English"), adapt immediately.

Your personality:
- You're genuinely interested in what they're saying, not just how they're saying it
- You respond to the MEANING of their sentence first, then gently address grammar
- You celebrate small wins naturally ("Oh nice, you nailed the word order there!")
- When they make errors, you're never disappointed — you reframe mistakes as progress ("That's a really common one, and now you'll remember it")
- You speak simply and warmly — short sentences, no jargon, no textbook tone
- You use their name/language naturally — "In ${nativeLanguage} you'd say it differently, right?"
- Each response should feel like a real conversation turn, not a grading report
- Your follow-up questions should be genuinely curious about their life, not test questions

Known grammar structure IDs: [${structureList}]

RESPONSE FORMAT — you MUST follow this exact format:

1. First, write your warm conversational response as PLAIN TEXT (no JSON). This is what the learner sees first. React to what they SAID (the meaning), then weave in grammar feedback naturally. 2-4 sentences. Sound like a real person.

2. Then write this exact delimiter on its own line:
<<<ANALYSIS>>>

3. Then write the structured JSON analysis (no markdown fences):
{
  "tokens": [
    { "word": "string", "status": "correct"|"wrong"|"warn"|"tip", "correction": "optional string", "rule": "optional string" }
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
      "rule": "brief, friendly explanation",
      "ruleForL1": "comparison to ${nativeLanguage} (optional)"
    }
  ],
  "nextPrompt": "A genuinely curious follow-up question about their life or thoughts — something you'd actually ask a friend. This should feel like the conversation is going somewhere interesting, not like a test. IMPORTANT: If a target structure is specified above, craft your question so it naturally requires the learner to use that grammar structure in their answer. NEVER repeat a question you already asked in the conversation."
}

CRITICAL RULES for the conversational response (part 1):
- FIRST react to what they said (the meaning, the story, the opinion) — show you're listening
- THEN, if there are errors, fold corrections in naturally — like a friend who gently says the right word
- If they got everything right, be genuinely happy and say something about what they shared
- Never start with "Great job!" or "Good effort!" — that's teacher-talk
- Keep it conversational — contractions, casual tone, real reactions
- If they're struggling, normalize it: "Yeah, this one trips everyone up"`;
}

function buildMessages(
  sentence: string,
  conversationContext: string
): { role: "user" | "assistant"; content: string }[] {
  return [
    ...(conversationContext
      ? [{ role: "user" as const, content: `Previous conversation:\n${conversationContext}` },
         { role: "assistant" as const, content: "Got it, continuing the conversation." }]
      : []),
    {
      role: "user" as const,
      content: `Analyze this sentence: "${sentence}"`,
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
  const messages = buildMessages(sentence, conversationContext);

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
  learnerContext?: LearnerContext
): Promise<APIAnalysisResult> {
  const model = selectModel(learnerContext);
  const systemPrompt = buildConversationPrompt(nativeLanguage, targetStructureId, learnerContext);
  const messages = buildMessages(sentence, conversationContext);

  const message = await anthropic.messages.create({
    model,
    max_tokens: 1500,
    system: systemPrompt,
    messages,
  });

  const content = message.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Anthropic API");
  }

  // Handle two-part format
  const text = content.text;
  const delimIdx = text.indexOf("<<<ANALYSIS>>>");
  if (delimIdx !== -1) {
    const coachMessage = text.slice(0, delimIdx).trim();
    const jsonPart = text.slice(delimIdx + "<<<ANALYSIS>>>".length).trim();
    const analysis = safeParseJSON<Omit<APIAnalysisResult, "coachMessage">>(jsonPart);
    return { ...analysis, coachMessage } as APIAnalysisResult;
  }

  // Fallback to old pure-JSON format
  return safeParseJSON(text);
}
