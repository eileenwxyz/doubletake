"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CheckReport } from "@/lib/check/types";
import {
  EXAMPLES,
  FORM,
  GENERIC_ERROR,
  INPUT_ERRORS,
  RESULT,
  SITE_NAME,
  STATUS,
  TAGLINE,
  VERDICT_LABELS,
} from "@/lib/copy";
import { EXAMPLE_RESULTS } from "@/lib/examples";
import { interpretResponse, showChecksLeft } from "@/lib/present";
import Result from "./result";
import { VerdictIcon } from "./ui";

const MAX_LENGTH = 200;
const SLOW_AFTER_MS = 30_000;
const GIVE_UP_AFTER_MS = 60_000;

type View =
  | { kind: "idle" }
  | { kind: "checking"; slow: boolean }
  | { kind: "result"; report: CheckReport; example: boolean }
  | { kind: "need_detail"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "error" };

export default function Checker() {
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [checksRemaining, setChecksRemaining] = useState<number | null>(null);
  // Set once the daily limit or monthly cap is reached; examples still work.
  const [blocked, setBlocked] = useState<{ which: "daily" | "monthly"; message: string } | null>(
    null,
  );

  const companyRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const controller = useRef<AbortController | null>(null);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  useEffect(
    () => () => {
      clearTimers();
      controller.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (view.kind === "need_detail") emailRef.current?.focus();
    if (view.kind === "error") retryRef.current?.focus();
  }, [view]);

  async function runCheck() {
    if (company.trim() === "") {
      setView({ kind: "invalid", message: INPUT_ERRORS.noCompany });
      companyRef.current?.focus();
      return;
    }

    clearTimers();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setView({ kind: "checking", slow: false });
    timers.current.push(
      setTimeout(() => setView({ kind: "checking", slow: true }), SLOW_AFTER_MS),
      setTimeout(() => abort.abort(), GIVE_UP_AFTER_MS),
    );

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, email }),
        signal: abort.signal,
      });
      const data: unknown = await response.json().catch(() => null);
      const outcome = interpretResponse(response.status, data);
      if (abort.signal.aborted) throw new Error("gave up");
      switch (outcome.kind) {
        case "result":
          setChecksRemaining(outcome.checksRemaining);
          setView({ kind: "result", report: outcome.report, example: false });
          window.scrollTo({ top: 0 });
          break;
        case "need_detail":
          setChecksRemaining(outcome.checksRemaining);
          setView({ kind: "need_detail", message: outcome.message });
          break;
        case "limit":
          setBlocked({ which: outcome.which, message: outcome.message });
          setView({ kind: "idle" });
          break;
        case "invalid":
          setView({ kind: "invalid", message: outcome.message });
          break;
        case "error":
          setView({ kind: "error" });
          break;
      }
    } catch {
      // Only the latest request decides the screen; one cancelled by going
      // back home is ignored.
      if (controller.current === abort) setView({ kind: "error" });
    } finally {
      if (controller.current === abort) {
        clearTimers();
        controller.current = null;
      }
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runCheck();
  }

  function showExample(report: CheckReport) {
    setView({ kind: "result", report, example: true });
    window.scrollTo({ top: 0 });
  }

  function goToForm() {
    formRef.current?.scrollIntoView({ block: "start" });
    companyRef.current?.focus({ preventScroll: true });
  }

  function goHome() {
    const current = controller.current;
    controller.current = null;
    current?.abort();
    clearTimers();
    setView({ kind: "idle" });
  }

  const checking = view.kind === "checking";
  const showingResult = view.kind === "result";
  const showExamples = !checking && !(view.kind === "result" && !view.example);

  return (
    <>
      {showingResult ? (
        <div className="topbar">
          <button type="button" className="text-button site-name" onClick={goHome}>
            {SITE_NAME}
          </button>
        </div>
      ) : (
        <header className="hero">
          <h1 className="hero-title">{SITE_NAME}</h1>
          <p className="hero-tagline">{TAGLINE}</p>
        </header>
      )}

      {view.kind === "result" && (
        <Result report={view.report} isExample={view.example} onNotThisOne={goToForm} />
      )}

      <section
        ref={formRef}
        id="check"
        className="check"
        aria-label={showingResult ? RESULT.checkAnother : undefined}
      >
        {showingResult && <h2 className="section-heading">{RESULT.checkAnother}</h2>}
        <form onSubmit={onSubmit} className="form" noValidate>
          <div className="field">
            <label htmlFor="company" className="field-label">
              {FORM.companyLabel}
            </label>
            <input
              ref={companyRef}
              id="company"
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={MAX_LENGTH}
              required
              aria-invalid={view.kind === "invalid" ? true : undefined}
              aria-describedby={view.kind === "invalid" ? "form-message" : undefined}
              className="input"
            />
          </div>
          <div className="field">
            <label htmlFor="email" className="field-label">
              {FORM.emailLabel}
            </label>
            <input
              ref={emailRef}
              id="email"
              type="text"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={MAX_LENGTH}
              aria-describedby={view.kind === "need_detail" ? "form-message" : undefined}
              className="input input--mono"
            />
          </div>
          <div className="form-actions">
            <button
              type="submit"
              className="button button--primary"
              disabled={checking || blocked !== null}
            >
              {checking ? FORM.submitting : FORM.submit}
            </button>

            <div role="status" aria-live="polite" className="form-status">
              {checking && (
                <p className="checking">
                  <span className="spinner" aria-hidden="true" />
                  <span>{view.slow ? STATUS.slow : STATUS.checking}</span>
                </p>
              )}
            </div>

            {blocked ? (
              <p role="alert" className="notice notice--limit">
                {blocked.message}
              </p>
            ) : (
              showChecksLeft(checksRemaining) &&
              !checking && <p className="checks-left">{STATUS.checksLeft(checksRemaining!)}</p>
            )}
          </div>
        </form>

        {view.kind === "invalid" && (
          <p id="form-message" role="alert" className="notice">
            {view.message}
          </p>
        )}
        {view.kind === "need_detail" && (
          <p id="form-message" role="alert" className="notice notice--detail">
            {view.message}
          </p>
        )}
        {view.kind === "error" && (
          <div role="alert" className="notice notice--error">
            <p>{GENERIC_ERROR}</p>
            <p className="notice-small">{STATUS.notCounted}</p>
            <button
              ref={retryRef}
              type="button"
              className="button"
              onClick={() => void runCheck()}
              disabled={blocked !== null}
            >
              {STATUS.retry}
            </button>
          </div>
        )}
      </section>

      {showExamples && (
        <section className="examples" aria-labelledby="examples-heading">
          <h2 id="examples-heading" className="section-heading">
            {EXAMPLES.heading}
          </h2>
          <p className="examples-intro">{EXAMPLES.intro}</p>
          <ul className="example-list">
            {EXAMPLE_RESULTS.map(({ id, report }) => (
              <li key={id}>
                <button
                  type="button"
                  className={`example example--${report.verdict}`}
                  onClick={() => showExample(report)}
                  aria-current={
                    view.kind === "result" && view.report === report ? "true" : undefined
                  }
                >
                  <span className="badge">{EXAMPLES.label}</span>
                  <span className="example-name">{report.companyName}</span>
                  <span className="example-verdict">
                    <VerdictIcon verdict={report.verdict} />
                    {VERDICT_LABELS[report.verdict]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
