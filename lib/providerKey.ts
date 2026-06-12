import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/**
 * BYOK helpers — extract user-provided API keys from request headers.
 *
 * Hosted-app users store their own keys in localStorage and the client
 * forwards them as custom headers on every API call. Self-hosted users
 * never need this — their keys live in .env.local.
 *
 * Priority: user header > ANTHROPIC_API_KEY env var
 */

export function getAnthropicKey(req: NextRequest): string | undefined {
  return req.headers.get("x-anthropic-key") || process.env.ANTHROPIC_API_KEY || undefined;
}

export function getOpenAIKey(req: NextRequest): string | undefined {
  return req.headers.get("x-openai-key") || process.env.OPENAI_API_KEY || undefined;
}

export function makeAnthropicClient(apiKey?: string | null): Anthropic {
  return new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
}

export function makeOpenAIClient(apiKey?: string | null): OpenAI {
  return new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });
}
