"use client";

import { useState, type FormEvent } from "react";

type Result = {
  title: string;
  url: string;
  publishDate: string | null;
  excerpt: string;
  source: "official" | "warnings";
};

const MAX_LENGTH = 200;
const GENERIC_ERROR = "Something went wrong. Try again.";

export default function CheckForm() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
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
        setResults(data.results);
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

      {results && (
        <div className="mt-8">
          {results.length === 0 ? (
            <p>No results found.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {results.map((result, index) => (
                <li key={`${result.source}-${index}`}>
                  <a href={result.url} className="underline" rel="noopener noreferrer">
                    {result.title}
                  </a>
                  <div className="text-sm text-foreground/70">
                    {result.source === "official" ? "Official presence" : "Warnings"}
                    {result.publishDate && ` · ${result.publishDate}`}
                  </div>
                  {result.excerpt && <p className="text-sm">{result.excerpt}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
