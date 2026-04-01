"use client";

interface SpeakButtonProps {
  onClick: () => void;
  speaking: boolean;
  size?: "sm" | "md";
}

/** Small inline button to replay a coach message aloud */
export default function SpeakButton({ onClick, speaking, size = "sm" }: SpeakButtonProps) {
  const dim = size === "sm" ? "h-6 w-6" : "h-8 w-8";
  const icon = size === "sm" ? 14 : 16;

  return (
    <button
      onClick={onClick}
      className={`flex ${dim} shrink-0 items-center justify-center rounded-full transition-colors ${
        speaking
          ? "bg-gray-900 text-white animate-pulse"
          : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
      }`}
      title={speaking ? "Stop" : "Listen"}
    >
      {speaking ? (
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg width={icon} height={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  );
}
