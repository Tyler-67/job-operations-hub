import { useEffect, useState, type ReactNode } from "react";

interface TokenPayload {
  token?: string;
  action?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

interface Props {
  tokenAction: string;
  title: string;
  consumeOnLoad?: boolean;
  children?: (payload: TokenPayload) => ReactNode;
}

export default function TokenForm({ tokenAction, title, consumeOnLoad = false, children }: Props) {
  const [status, setStatus] = useState<"loading" | "ok" | "invalid">("loading");
  const [payload, setPayload] = useState<TokenPayload | null>(null);

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const token = url.searchParams.get("token");
      if (!token) {
        setStatus("invalid");
        return;
      }
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/action-token-consume`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ token, action: tokenAction, consume: consumeOnLoad }),
        });
        const json = await res.json() as TokenPayload;
        if (!res.ok) {
          setStatus("invalid");
          return;
        }
        setPayload({ ...json, token });
        setStatus("ok");
      } catch {
        setStatus("invalid");
      }
    })();
  }, [consumeOnLoad, tokenAction]);

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-base font-semibold">{title}</h1>
      {status === "loading" && <div className="text-sm text-muted-foreground">Validating link...</div>}
      {status === "invalid" && (
        <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          This link is invalid or has expired. Request a new one.
        </div>
      )}
      {status === "ok" && (children && payload ? children(payload) : <div className="text-sm">Form handler pending.</div>)}
    </div>
  );
}
