"use client";

import { createContext, useCallback, useContext, useState } from "react";

export type LessonUIState = {
  showReferenceTable: boolean;
  hasErrorSpot: boolean;
};

const defaultState: LessonUIState = {
  showReferenceTable: true,
  hasErrorSpot: false,
};

type ContextValue = {
  state: LessonUIState;
  set: (patch: Partial<LessonUIState>) => void;
};

const LessonUIContext = createContext<ContextValue>({
  state: defaultState,
  set: () => {},
});

export function LessonUIProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LessonUIState>(defaultState);
  const set = useCallback((patch: Partial<LessonUIState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);
  return (
    <LessonUIContext.Provider value={{ state, set }}>
      {children}
    </LessonUIContext.Provider>
  );
}

export function useLessonUI() {
  return useContext(LessonUIContext);
}
