"use client";

import { useState, type FormEvent } from "react";
import type { CheckResponse, Verdict } from "@/lib/check/types";

const VERDICT_LABELS: Record<Verdict, string> = {
  strong_warning: "Strong warning signs",
  mixed: "Mixed signals",
  no_red_flags: "No red flags found",
  not_enough: "Not enough information",
};

const DIRECTION_LABELS = {
  reassures: "Reassures",
  caution: "Caution",
  neutral: "Neutral",
} as const;

const MAX_LENGTH = 200;
const GENERIC_ERROR = "Something went wrong. Try again.";

export default function CheckForm() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [results, setResults] = useState<CheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResults(null);

    if (company.trim() === "") {
      setError("Enter a company name.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, email }),
      });
      const data = await response.json();
      if (
        (response.status === 400 || response.status === 429) &&
        typeof data.error === "string"
      ) {
        setError(data.error);
      } else if (!response.ok) {
        setError(GENERIC_ERROR);
      } else {
        setResults(data as CheckResponse);
      }
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-10 w-full max-w-xl text-left">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          Company
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            maxLength={MAX_LENGTH}
            required
            className="rounded border border-foreground/30 bg-transparent px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          Recruiter&apos;s email (optional)
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={MAX_LENGTH}
            className="rounded border border-foreground/30 bg-transparent px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="self-start rounded border border-foreground/30 px-4 py-2 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-6">
          {error}
        </p>
      )}

      {results && results.status === "need_more_detail" && (
        <p className="mt-8">{results.message}</p>
      )}

      {results && results.status === "ok" && (
        <div className="mt-8 flex flex-col gap-4">
          <div>
            <p>{VERDICT_LABELS[results.verdict]}</p>
            {results.subtitle && (
              <p className="text-sm text-foreground/70">{results.subtitle}</p>
            )}
          </div>

          {results.companySays && (
            <p className="text-sm">
              The company says: &ldquo;{results.companySays.quote}&rdquo; (
              {results.companySays.domain})
            </p>
          )}

          {results.reasons.length > 0 && (
            <ul className="flex flex-col gap-4">
              {results.reasons.map((reason, index) => (
                <li key={`reason-${index}`}>
                  <p className="text-sm">
                    {DIRECTION_LABELS[reason.direction]}: {reason.text}
                  </p>
                  <div className="text-sm text-foreground/70">
                    {reason.sourceType} · {reason.age}
                    {reason.sourceUrl && (
                      <>
                        {" · "}
                        <a
                          href={reason.sourceUrl}
                          className="underline"
                          rel="noopener noreferrer"
                        >
                          {reason.sourceUrl}
                        </a>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {results.couldntFind.length > 0 && (
            <div>
              <p>Couldn&apos;t find</p>
              <ul className="flex flex-col gap-4">
                {results.couldntFind.map((item, index) => (
                  <li key={`missing-${index}`} className="text-sm">
                    {item.kind === "couldnt_check" ? "Couldn't check" : "Not published"}:{" "}
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.sources.length > 0 && (
            <div>
              <p>Sources</p>
              <ul className="flex flex-col gap-4">
                {results.sources.map((source, index) => (
                  <li key={`source-${index}`}>
                    <a href={source.url} className="underline" rel="noopener noreferrer">
                      {source.url}
                    </a>
                    <div className="text-sm text-foreground/70">
                      {source.type}
                      {source.publishDate && ` · ${source.publishDate}`}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
