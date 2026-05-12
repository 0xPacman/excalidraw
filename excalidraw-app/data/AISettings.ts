import { EDITOR_LS_KEYS } from "@excalidraw/common";
import { useEffect } from "react";

import { atom, useAtom } from "../app-jotai";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const AI_MODEL_STORAGE_KEY = "excalidraw-oai-model";

export type AISettings = {
  apiKey: string;
  model: string;
};

const getLocalStorageValue = (key: string) => {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const loadAISettings = (): AISettings => {
  const savedModel = getLocalStorageValue(AI_MODEL_STORAGE_KEY).trim();
  return {
    apiKey: getLocalStorageValue(EDITOR_LS_KEYS.OAI_API_KEY),
    model: savedModel || DEFAULT_OPENAI_MODEL,
  };
};

const persistAISettings = (settings: AISettings) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const apiKey = settings.apiKey.trim();
    const model = settings.model.trim();

    if (apiKey) {
      window.localStorage.setItem(EDITOR_LS_KEYS.OAI_API_KEY, apiKey);
    } else {
      window.localStorage.removeItem(EDITOR_LS_KEYS.OAI_API_KEY);
    }

    if (model) {
      window.localStorage.setItem(AI_MODEL_STORAGE_KEY, model);
    } else {
      window.localStorage.removeItem(AI_MODEL_STORAGE_KEY);
    }
  } catch {
    // ignore browser storage failures
  }
};

export const aiSettingsAtom = atom<AISettings>(loadAISettings());

export const useAISettings = () => {
  const [settings, setSettings] = useAtom(aiSettingsAtom);

  useEffect(() => {
    persistAISettings(settings);
  }, [settings]);

  return [settings, setSettings] as const;
};
