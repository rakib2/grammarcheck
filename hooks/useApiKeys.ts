"use client";

import { useState, useEffect, useCallback } from "react";

export interface ApiKeys {
  anthropicKey: string;
  openaiKey: string;
}

const STORAGE_KEY = "grammarflow_api_keys";

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKeys>({ anthropicKey: "", openaiKey: "" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setKeys(JSON.parse(stored));
    } catch {
      // localStorage unavailable
    }
    setLoaded(true);
  }, []);

  const saveKeys = useCallback((next: ApiKeys) => {
    setKeys(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const clearKeys = useCallback(() => {
    setKeys({ anthropicKey: "", openaiKey: "" });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  /** Build custom headers to attach to every API call. */
  const apiHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (keys.anthropicKey) h["x-anthropic-key"] = keys.anthropicKey;
    if (keys.openaiKey) h["x-openai-key"] = keys.openaiKey;
    return h;
  }, [keys]);

  const hasAnthropicKey = Boolean(keys.anthropicKey);
  const hasOpenAIKey = Boolean(keys.openaiKey);

  return { keys, saveKeys, clearKeys, apiHeaders, loaded, hasAnthropicKey, hasOpenAIKey };
}
