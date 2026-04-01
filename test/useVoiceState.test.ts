/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVoiceState } from "@/lib/useVoiceState";

describe("useVoiceState", () => {
  it("starts in IDLE state", () => {
    const { result } = renderHook(() => useVoiceState());
    expect(result.current.state).toBe("IDLE");
    expect(result.current.canRecord).toBe(true);
    expect(result.current.canSpeak).toBe(true);
  });

  describe("IDLE → RECORDING", () => {
    it("transitions to RECORDING on startRecording", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      expect(result.current.state).toBe("RECORDING");
      expect(result.current.canRecord).toBe(false);
      expect(result.current.canSpeak).toBe(false);
    });
  });

  describe("RECORDING → PROCESSING", () => {
    it("transitions to PROCESSING on startProcessing", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      expect(result.current.state).toBe("PROCESSING");
    });
  });

  describe("RECORDING → IDLE", () => {
    it("transitions to IDLE on stopRecording", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.stopRecording());
      expect(result.current.state).toBe("IDLE");
    });
  });

  describe("PROCESSING → SPEAKING", () => {
    it("transitions to SPEAKING on startSpeaking", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      act(() => result.current.startSpeaking());
      expect(result.current.state).toBe("SPEAKING");
      expect(result.current.canRecord).toBe(false);
    });
  });

  describe("SPEAKING → IDLE", () => {
    it("transitions to IDLE on finishSpeaking (no auto-listen)", () => {
      const { result } = renderHook(() => useVoiceState({ autoListen: false }));
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      act(() => result.current.startSpeaking());
      act(() => result.current.finishSpeaking());
      expect(result.current.state).toBe("IDLE");
    });
  });

  describe("SPEAKING → RECORDING (auto-listen)", () => {
    it("transitions to RECORDING on finishSpeaking with auto-listen", () => {
      const { result } = renderHook(() => useVoiceState({ autoListen: true }));
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      act(() => result.current.startSpeaking());
      act(() => result.current.finishSpeaking());
      expect(result.current.state).toBe("RECORDING");
    });
  });

  describe("blocked transitions", () => {
    it("blocks startRecording during SPEAKING", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      act(() => result.current.startSpeaking());
      act(() => result.current.startRecording());
      expect(result.current.state).toBe("SPEAKING"); // unchanged
    });

    it("blocks startRecording during PROCESSING", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      act(() => result.current.startRecording());
      expect(result.current.state).toBe("PROCESSING"); // unchanged
    });

    it("blocks startSpeaking during RECORDING", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.startSpeaking());
      expect(result.current.state).toBe("RECORDING"); // unchanged
    });
  });

  describe("reset", () => {
    it("resets to IDLE from any state", () => {
      const { result } = renderHook(() => useVoiceState());
      act(() => result.current.startRecording());
      act(() => result.current.startProcessing());
      act(() => result.current.startSpeaking());
      act(() => result.current.reset());
      expect(result.current.state).toBe("IDLE");
    });
  });
});
