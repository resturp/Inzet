"use client";

import { useState } from "react";

type StackEditFile = {
  content?: {
    text?: string;
  };
};

type StackEditInstance = {
  openFile: (
    file: {
      name?: string;
      content: {
        text: string;
      };
    },
    silent?: boolean
  ) => void;
  on: (eventName: "fileChange" | "close", callback: (file: StackEditFile) => void) => void;
};

type StackEditConstructor = new (options?: { url?: string }) => StackEditInstance;

declare global {
  interface Window {
    Stackedit?: StackEditConstructor;
    __stackeditScriptPromise?: Promise<void>;
  }
}

const STACKEDIT_SCRIPT_URL = "https://unpkg.com/stackedit-js/docs/lib/stackedit.min.js";

function loadStackEditScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("StackEdit werkt alleen in de browser."));
  }
  if (window.Stackedit) {
    return Promise.resolve();
  }
  if (window.__stackeditScriptPromise) {
    return window.__stackeditScriptPromise;
  }

  window.__stackeditScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = STACKEDIT_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("StackEdit script kon niet geladen worden."));
    document.head.appendChild(script);
  });

  return window.__stackeditScriptPromise;
}

type StackeditMarkdownEditorProps = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  rows?: number;
  placeholder?: string;
  fileName?: string;
  disabled?: boolean;
};

export function StackeditMarkdownEditor({
  label,
  value,
  onChange,
  rows = 5,
  placeholder,
  fileName = "Markdown",
  disabled = false
}: StackeditMarkdownEditorProps) {
  const [isOpening, setIsOpening] = useState(false);
  const [stackEditError, setStackEditError] = useState<string | null>(null);

  async function onOpenStackEdit() {
    setIsOpening(true);
    setStackEditError(null);
    try {
      await loadStackEditScript();
      if (!window.Stackedit) {
        throw new Error("StackEdit is niet beschikbaar.");
      }

      const stackedit = new window.Stackedit({
        url: "https://stackedit.io/app"
      });

      stackedit.on("fileChange", (file) => {
        onChange(file.content?.text ?? "");
      });

      stackedit.on("close", () => {
        setIsOpening(false);
      });

      stackedit.openFile({
        name: fileName,
        content: { text: value }
      });
    } catch (error) {
      setIsOpening(false);
      setStackEditError(error instanceof Error ? error.message : "StackEdit openen mislukt.");
    }
  }

  return (
    <div className="grid">
      <label>
        {label}
        <textarea
          rows={rows}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      </label>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={onOpenStackEdit} disabled={disabled || isOpening}>
          {isOpening ? "StackEdit openen..." : "Open StackEdit editor"}
        </button>
        <p className="muted">Webeditor met live markdown-opmaak.</p>
      </div>
      {stackEditError ? <p className="muted">{stackEditError}</p> : null}
    </div>
  );
}
