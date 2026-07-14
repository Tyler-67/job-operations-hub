import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PromptOptions {
  title: string;
  body?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

type Request =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

interface DialogApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

// In-page replacements for window.confirm / window.prompt, matching the app's
// hand-rolled overlay modal style. Promise-based so a call site reads like the
// browser dialog it replaces: `if (!(await confirm({...}))) return;`.
export function DialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [text, setText] = useState("");

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ kind: "confirm", options, resolve })),
    [],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setText(options.defaultValue ?? "");
        setRequest({ kind: "prompt", options, resolve });
      }),
    [],
  );

  function settle(result: boolean | string | null) {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(result as boolean);
    else request.resolve(result as string | null);
    setRequest(null);
  }

  const cancelResult = request?.kind === "prompt" ? null : false;

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {request && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => settle(cancelResult)}>
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-4 text-foreground" onClick={(event) => event.stopPropagation()}>
            <h2 className="mb-1 text-sm font-semibold">{request.options.title}</h2>
            {request.options.body && <p className="mb-3 whitespace-pre-line text-xs text-muted-foreground">{request.options.body}</p>}
            {request.kind === "prompt" && (
              <div className="space-y-1">
                {request.options.label && <label className="block text-2xs text-muted-foreground">{request.options.label}</label>}
                <input
                  autoFocus
                  value={text}
                  placeholder={request.options.placeholder}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") settle(text); }}
                  className="h-9 w-full rounded-sm border border-input bg-background px-2 text-xs"
                />
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => settle(cancelResult)} className="inline-flex h-8 items-center rounded-sm border border-border px-3 text-xs hover:bg-muted">
                {(request.kind === "confirm" && request.options.cancelLabel) || "Cancel"}
              </button>
              <button
                type="button"
                autoFocus={request.kind === "confirm"}
                onClick={() => settle(request.kind === "confirm" ? true : text)}
                className={cn(
                  "inline-flex h-8 items-center rounded-sm px-3 text-xs font-medium text-primary-foreground hover:opacity-90",
                  request.kind === "confirm" && request.options.destructive ? "bg-destructive text-destructive-foreground" : "bg-primary",
                )}
              >
                {request.options.confirmLabel ?? (request.kind === "confirm" ? "Confirm" : "OK")}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useConfirm must be used within DialogProvider");
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("usePrompt must be used within DialogProvider");
  return ctx.prompt;
}
