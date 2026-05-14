import { Dialog } from "@excalidraw/excalidraw/components/Dialog";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { TextField } from "@excalidraw/excalidraw/components/TextField";
import { useEffect, useMemo, useState } from "react";

import { atom, useAtom } from "../app-jotai";
import { DEFAULT_OPENAI_MODEL } from "../data/AISettings";

import "./AISettingsDialog.scss";

import type { AISettings } from "../data/AISettings";

export const aiSettingsDialogStateAtom = atom(false);

const MODEL_PRESETS = [
  "gpt-oss-120b",
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o",
  "gpt-4o-mini",
  "o4-mini",
];

export const AISettingsDialog = ({
  settings,
  onSave,
}: {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
}) => {
  const [isOpen, setIsOpen] = useAtom(aiSettingsDialogStateAtom);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setApiKey(settings.apiKey);
    setModel(settings.model);
  }, [isOpen, settings.apiKey, settings.model]);

  const trimmedModel = useMemo(() => model.trim(), [model]);
  const canSave = trimmedModel.length > 0;

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog
      size="small"
      title="AI Settings"
      onCloseRequest={() => setIsOpen(false)}
    >
      <div className="AISettingsDialog">
        <p className="AISettingsDialog__description">
          Configure API credentials used by Text to Diagram and Wireframe to
          Code. Supports OpenAI keys (`sk-...`) and Cerebras keys (`csk-...`).
          Saved locally in your browser.
        </p>

        <TextField
          label="OpenAI API Key"
          value={apiKey}
          placeholder="sk-..."
          isRedacted
          fullWidth
          onChange={setApiKey}
        />

        <TextField
          label="Model"
          value={model}
          placeholder={DEFAULT_OPENAI_MODEL}
          fullWidth
          onChange={setModel}
        />

        <div className="AISettingsDialog__presets">
          {MODEL_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="AISettingsDialog__preset"
              onClick={() => setModel(preset)}
            >
              {preset}
            </button>
          ))}
        </div>

        <div className="AISettingsDialog__actions">
          <FilledButton
            size="medium"
            variant="outlined"
            label="Clear Key"
            onClick={() => setApiKey("")}
          />
          <FilledButton
            size="medium"
            variant="outlined"
            label="Cancel"
            onClick={() => setIsOpen(false)}
          />
          <FilledButton
            size="medium"
            label="Save"
            disabled={!canSave}
            onClick={() => {
              onSave({
                apiKey: apiKey.trim(),
                model: trimmedModel,
              });
              setIsOpen(false);
            }}
          />
        </div>
      </div>
    </Dialog>
  );
};
