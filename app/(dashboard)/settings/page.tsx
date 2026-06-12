"use client";

import { useState, useEffect } from "react";
import { useApiKeys } from "@/hooks/useApiKeys";

function MaskedKey({ value }: { value: string }) {
  if (!value) return <span className="text-gray-400 text-xs">Not set</span>;
  const visible = value.slice(0, 8);
  const masked = "•".repeat(Math.min(20, value.length - 8));
  return (
    <span className="font-mono text-xs text-gray-600">
      {visible}{masked}
    </span>
  );
}

export default function SettingsPage() {
  const { keys, saveKeys, clearKeys, loaded } = useApiKeys();
  const [anthropicInput, setAnthropicInput] = useState("");
  const [openaiInput, setOpenaiInput] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded) {
      setAnthropicInput(keys.anthropicKey);
      setOpenaiInput(keys.openaiKey);
    }
  }, [loaded, keys.anthropicKey, keys.openaiKey]);

  function handleSave() {
    saveKeys({ anthropicKey: anthropicInput.trim(), openaiKey: openaiInput.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClear() {
    clearKeys();
    setAnthropicInput("");
    setOpenaiInput("");
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-lg font-semibold text-gray-900 mb-1">API Keys</h1>
      <p className="text-sm text-gray-500 mb-6">
        GrammarFlow is open-source and runs on your own API keys. Keys are stored
        only in your browser (localStorage) and sent directly to the server on each
        request — they are never stored in our database.
      </p>

      <div className="space-y-6">
        {/* Anthropic */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-gray-900">Anthropic (Claude)</p>
              <p className="text-xs text-gray-500 mt-0.5">Used for grammar analysis, lessons, and conversations</p>
            </div>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Get key →
            </a>
          </div>
          {keys.anthropicKey && (
            <p className="mb-2 text-xs text-gray-400">
              Current: <MaskedKey value={keys.anthropicKey} />
            </p>
          )}
          <input
            type="password"
            value={anthropicInput}
            onChange={(e) => setAnthropicInput(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-mono placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
        </div>

        {/* OpenAI */}
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-medium text-gray-900">OpenAI</p>
              <p className="text-xs text-gray-500 mt-0.5">Used for voice conversation (Realtime API), TTS, and Whisper</p>
            </div>
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-700"
            >
              Get key →
            </a>
          </div>
          {keys.openaiKey && (
            <p className="mb-2 text-xs text-gray-400">
              Current: <MaskedKey value={keys.openaiKey} />
            </p>
          )}
          <input
            type="password"
            value={openaiInput}
            onChange={(e) => setOpenaiInput(e.target.value)}
            placeholder="sk-proj-..."
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-mono placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          />
          <p className="mt-2 text-xs text-gray-400">
            Optional — only needed for voice practice features.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
          >
            {saved ? "Saved" : "Save keys"}
          </button>
          {(keys.anthropicKey || keys.openaiKey) && (
            <button
              onClick={handleClear}
              className="rounded-md border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Self-host note */}
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
          <p className="text-xs font-medium text-gray-700 mb-1">Self-hosting</p>
          <p className="text-xs text-gray-500">
            Running your own instance? Add keys to <code className="font-mono bg-gray-200 px-1 rounded">.env.local</code> instead — no need to enter them here.
            See the{" "}
            <a
              href="https://github.com/rakib2/grammarcoach#self-hosting"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-700"
            >
              setup guide
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
