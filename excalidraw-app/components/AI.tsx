import {
  DiagramToCodePlugin,
  exportToBlob,
  getTextFromElements,
  MIME_TYPES,
  TTDDialog,
  TTDStreamFetch,
} from "@excalidraw/excalidraw";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import { getDataURL } from "@excalidraw/excalidraw/data/blob";
import { safelyParseJSON } from "@excalidraw/common";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEFAULT_OPENAI_MODEL } from "../data/AISettings";
import { TTDIndexedDBAdapter } from "../data/TTDStorage";

import "./AI.scss";

import type { AISettings } from "../data/AISettings";

export const AIComponents = ({
  excalidrawAPI,
  aiSettings,
  onOpenAISettings,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  aiSettings: AISettings;
  onOpenAISettings: () => void;
}) => {
  const normalizedAIConfig = {
    apiKey: aiSettings.apiKey.trim(),
    model: aiSettings.model.trim() || DEFAULT_OPENAI_MODEL,
  };

  const customOpenAIConfig =
    normalizedAIConfig.apiKey ||
    normalizedAIConfig.model !== DEFAULT_OPENAI_MODEL
      ? {
          openaiApiKey: normalizedAIConfig.apiKey || undefined,
          openaiModel: normalizedAIConfig.model,
          apiKey: normalizedAIConfig.apiKey || undefined,
          model: normalizedAIConfig.model,
        }
      : {};

  const getAIErrorMessage = (error: unknown, fallback: string) => {
    const message = `${
      error instanceof Error ? error.message : fallback
    }`.trim();
    const normalized = message.toLowerCase();
    const shouldSuggestSettings =
      normalized.includes("api key") ||
      normalized.includes("model") ||
      normalized.includes("unauthorized") ||
      normalized.includes("forbidden") ||
      normalized.includes("invalid");

    if (!shouldSuggestSettings) {
      return message || fallback;
    }

    return `${
      message || fallback
    }\n\nCheck AI Settings in the main menu and verify your API key/model.`;
  };

  return (
    <>
      <DiagramToCodePlugin
        generate={async ({ frame, children }) => {
          const appState = excalidrawAPI.getAppState();

          const blob = await exportToBlob({
            elements: children,
            appState: {
              ...appState,
              exportBackground: true,
              viewBackgroundColor: appState.viewBackgroundColor,
            },
            exportingFrame: frame,
            files: excalidrawAPI.getFiles(),
            mimeType: MIME_TYPES.jpg,
          });

          const dataURL = await getDataURL(blob);

          const textFromFrameChildren = getTextFromElements(children);

          const response = await fetch(
            `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/diagram-to-code/generate`,
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                texts: textFromFrameChildren,
                image: dataURL,
                theme: appState.theme,
                ...customOpenAIConfig,
              }),
            },
          );

          if (!response.ok) {
            const text = await response.text();
            const errorJSON = safelyParseJSON(text);

            if (!errorJSON) {
              throw new Error(text);
            }

            if (errorJSON.statusCode === 429) {
              return {
                html: `<html>
                <body style="margin: 0; text-align: center">
                <div style="display: flex; align-items: center; justify-content: center; flex-direction: column; height: 100vh; padding: 0 60px">
                  <div style="color:red">Too many requests today,</br>please try again tomorrow!</div>
                  </br>
                  </br>
                  <div>You can also try <a href="${
                    import.meta.env.VITE_APP_PLUS_LP
                  }/plus?utm_source=excalidraw&utm_medium=app&utm_content=d2c" target="_blank" rel="noopener">Excalidraw+</a> to get more requests.</div>
                </div>
                </body>
                </html>`,
              };
            }

            throw new Error(
              getAIErrorMessage(errorJSON.message || text, "Generation failed"),
            );
          }

          try {
            const { html } = await response.json();

            if (!html) {
              throw new Error("Generation failed (invalid response)");
            }
            return {
              html,
            };
          } catch (error: any) {
            throw new Error(
              getAIErrorMessage(error, "Generation failed (invalid response)"),
            );
          }
        }}
      />

      <TTDDialog
        renderWelcomeScreen={() => (
          <div className="AIWelcome">
            <TTDDialog.WelcomeMessage />
            <div className="AIWelcome__footer">
              <div className="AIWelcome__text">
                Optional: add your OpenAI API key and model for more reliable AI
                generation.
              </div>
              <FilledButton
                size="medium"
                variant="outlined"
                label="AI Settings"
                onClick={onOpenAISettings}
              />
            </div>
          </div>
        )}
        renderWarning={(message) => {
          const content = `${message.content || ""} ${
            message.error || ""
          }`.toLowerCase();
          const shouldSuggestSettings =
            content.includes("api key") ||
            content.includes("unauthorized") ||
            content.includes("forbidden") ||
            content.includes("model");

          if (!shouldSuggestSettings) {
            return undefined;
          }

          return (
            <div className="AIWelcome__warning">
              <div>AI request failed. Verify API key/model in AI Settings.</div>
              <FilledButton
                size="medium"
                variant="outlined"
                label="Open AI Settings"
                onClick={onOpenAISettings}
              />
            </div>
          );
        }}
        onTextSubmit={async (props) => {
          const { onChunk, onStreamCreated, signal, messages } = props;

          const result = await TTDStreamFetch({
            url: `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/text-to-diagram/chat-streaming`,
            messages,
            body: customOpenAIConfig,
            onChunk,
            onStreamCreated,
            extractRateLimits: true,
            signal,
          });

          return result;
        }}
        persistenceAdapter={TTDIndexedDBAdapter}
      />
    </>
  );
};
