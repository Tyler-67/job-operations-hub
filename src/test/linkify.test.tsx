import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { linkify } from "@/lib/linkify";

// A linkify node is either a plain-text string or an <a> element; these helpers read them back.
function hrefOf(node: unknown): string | null {
  return isValidElement(node) ? String((node.props as { href: string }).href) : null;
}

describe("linkify", () => {
  it("returns plain text untouched when there is no URL", () => {
    expect(linkify("Daily check-in for 123 Main St.")).toEqual(["Daily check-in for 123 Main St."]);
  });

  it("turns a bare tokenized link into an anchor, keeping surrounding text", () => {
    const url = "https://job-operations-hub-dev.vercel.app/forms/daily-check-in?token=abc123";
    const nodes = linkify(`Tap to check in:\n\n${url}`);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toBe("Tap to check in:\n\n");
    expect(hrefOf(nodes[1])).toBe(url);
  });

  it("keeps trailing sentence punctuation out of the link", () => {
    const nodes = linkify("Full report: https://example.com/r/42.");
    expect(hrefOf(nodes[1])).toBe("https://example.com/r/42");
    expect(nodes[2]).toBe(".");
  });

  it("handles multiple URLs (multi-link asks render one option per line)", () => {
    const nodes = linkify("PASS:\nhttps://a.example/pass?token=1\n\nFAIL:\nhttps://a.example/fail?token=2");
    const hrefs = nodes.map(hrefOf).filter(Boolean);
    expect(hrefs).toEqual(["https://a.example/pass?token=1", "https://a.example/fail?token=2"]);
  });

  it("opens in a new tab without an opener", () => {
    const [node] = linkify("https://example.com");
    if (!isValidElement(node)) throw new Error("expected an anchor element");
    const props = node.props as { target: string; rel: string };
    expect(props.target).toBe("_blank");
    expect(props.rel).toBe("noopener noreferrer");
  });
});
