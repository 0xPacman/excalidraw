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
import { RequestError } from "@excalidraw/excalidraw/errors";
import { safelyParseJSON } from "@excalidraw/common";
import { useEffect, useRef } from "react";

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

  type ProviderConfig = {
    name: "cerebras" | "openai";
    url: string;
  };

  const directProviderConfig: ProviderConfig | null = normalizedAIConfig.apiKey
    ? normalizedAIConfig.apiKey.startsWith("csk-")
      ? {
          name: "cerebras",
          url: "https://api.cerebras.ai/v1/chat/completions",
        }
      : normalizedAIConfig.apiKey.startsWith("sk-")
      ? {
          name: "openai",
          url: "https://api.openai.com/v1/chat/completions",
        }
      : null
    : null;

  const isLikelyOpenAIOnlyModel = (model: string) =>
    /^(o\d|gpt-4|gpt-5|chatgpt)/i.test(model);

  const providerModel =
    directProviderConfig?.name === "cerebras" &&
    isLikelyOpenAIOnlyModel(normalizedAIConfig.model)
      ? "gpt-oss-120b"
      : normalizedAIConfig.model;

  const didShowAutoModelToastRef = useRef(false);

  useEffect(() => {
    if (
      directProviderConfig?.name === "cerebras" &&
      providerModel !== normalizedAIConfig.model &&
      !didShowAutoModelToastRef.current
    ) {
      didShowAutoModelToastRef.current = true;
      excalidrawAPI.setToast({
        message:
          "Cerebras key detected: switched AI model to gpt-oss-120b for compatibility.",
      });
    }
  }, [
    directProviderConfig?.name,
    excalidrawAPI,
    normalizedAIConfig.model,
    providerModel,
  ]);

  const parseRateLimit = (headers: Headers, name: string) => {
    const value = headers.get(name);
    if (!value) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const readCompletionContent = (responseBody: unknown): string => {
    const content =
      (responseBody as any)?.choices?.[0]?.message?.content?.trim?.() || "";
    return typeof content === "string" ? content : "";
  };

  const extractHtmlDocument = (content: string): string => {
    const match = content.match(/```(?:html)?\s*([\s\S]*?)```/i);
    const html = (match?.[1] || content).trim();
    return html;
  };

  const extractMermaidContent = (content: string): string => {
    const match = content.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
    const mermaid = (match?.[1] || content).trim();
    return mermaid;
  };

  const buildDirectProviderMessages = ({
    purpose,
    input,
  }: {
    purpose: "mermaid" | "html";
    input: string;
  }) => {
    const systemMessage =
      purpose === "mermaid"
        ? "You convert user requests into Mermaid flowchart syntax. Reply with Mermaid code only, no markdown fences and no extra text."
        : "You generate a complete single-file HTML document from wireframe notes. Reply with HTML only, no markdown fences and no explanation.";

    return [
      { role: "system", content: systemMessage },
      { role: "user", content: input },
    ];
  };

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
      normalized.includes("invalid") ||
      normalized.includes("provider");

    if (!shouldSuggestSettings) {
      return message || fallback;
    }

    return `${
      message || fallback
    }\n\nCheck AI Settings in the main menu and verify your API key/model/provider.`;
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

          if (directProviderConfig) {
            const providerResponse = await fetch(directProviderConfig.url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${normalizedAIConfig.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: providerModel,
                stream: false,
                messages: buildDirectProviderMessages({
                  purpose: "html",
                  input: [
                    `Theme: ${appState.theme}`,
                    "Wireframe notes:",
                    textFromFrameChildren || "(no text elements found)",
                    "Generate a polished, responsive webpage with semantic HTML and inline CSS.",
                  ].join("\n\n"),
                }),
              }),
            });

            if (!providerResponse.ok) {
              const text = await providerResponse.text();
              throw new Error(
                getAIErrorMessage(
                  text || `Provider error (${providerResponse.status})`,
                  "Generation failed",
                ),
              );
            }

            const completion = await providerResponse.json();
            const html = extractHtmlDocument(readCompletionContent(completion));

            if (!html) {
              throw new Error("Generation failed (empty provider response)");
            }

            return { html };
          }

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
                Optional: add an OpenAI (`sk-...`) or Cerebras (`csk-...`) API
                key and select a model.
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

          if (directProviderConfig) {
            onStreamCreated?.();
            try {
              const response = await fetch(directProviderConfig.url, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${normalizedAIConfig.apiKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: providerModel,
                  stream: false,
                  messages: buildDirectProviderMessages({
                    purpose: "mermaid",
                    input: messages
                      .map(
                        (message) =>
                          `${message.role.toUpperCase()}: ${message.content}`,
                      )
                      .join("\n\n"),
                  }),
                }),
                signal,
              });

              const rateLimit = parseRateLimit(
                response.headers,
                "x-ratelimit-limit",
              );
              const rateLimitRemaining = parseRateLimit(
                response.headers,
                "x-ratelimit-remaining",
              );

              if (!response.ok) {
                const text = await response.text();
                return {
                  rateLimit,
                  rateLimitRemaining,
                  error: new RequestError({
                    message: text || "Generation failed",
                    status: response.status,
                  }),
                };
              }

              const completion = await response.json();
              const generatedResponse = extractMermaidContent(
                readCompletionContent(completion),
              );

              if (!generatedResponse) {
                return {
                  rateLimit,
                  rateLimitRemaining,
                  error: new RequestError({
                    message: "Generation failed (empty provider response)",
                    status: 500,
                  }),
                };
              }

              onChunk?.(generatedResponse);

              return {
                generatedResponse,
                error: null,
                rateLimit,
                rateLimitRemaining,
              };
            } catch (error: any) {
              return {
                error: new RequestError({
                  message: getAIErrorMessage(error, "Generation failed"),
                  status: 500,
                }),
              };
            }
          }

          const result = await TTDStreamFetch({
            url: `${
              import.meta.env.VITE_APP_AI_BACKEND
            }/v1/ai/text-to-diagram/chat-streaming`,
            messages,
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
