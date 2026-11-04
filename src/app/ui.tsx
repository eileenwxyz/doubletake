"use client";

import { useId, useState, type ReactNode } from "react";
import type { Direction, Verdict } from "@/lib/check/types";
import { RESULT } from "@/lib/copy";
import { diffDomains, type Segment } from "@/lib/domain-diff";
import { splitDomains } from "@/lib/present";

// ---- Text ----

// A domain or email address in the mono font.
export function Mono({ children }: { children: ReactNode }) {
  return <span className="mono">{children}</span>;
}

// A sentence with every domain and email address in the mono font.
export function WithDomains({ text }: { text: string }) {
  return (
    <>
      {splitDomains(text).map((part, i) =>
        part.mono ? <Mono key={i}>{part.text}</Mono> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}

// ---- Icons (decorative; every icon sits next to a text label) ----

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const CHECK = <path d="M5 12.5l4.5 4.5L19 7.5" />;
const WARN = (
  <>
    <path d="M12 3.5L2.5 20h19L12 3.5z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </>
);
const HALF = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
  </>
);
const QUESTION = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 16.5v.01" />
  </>
);
const DASH = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </>
);

export function VerdictIcon({ verdict }: { verdict: Verdict }) {
  const shape = {
    strong_warning: WARN,
    mixed: HALF,
    no_red_flags: (
      <>
        <circle cx="12" cy="12" r="9" />
        {CHECK}
      </>
    ),
    not_enough: QUESTION,
  }[verdict];
  return <Svg className="icon--verdict">{shape}</Svg>;
}

export function DirectionIcon({ direction }: { direction: Direction }) {
  const shape = { reassures: CHECK, caution: WARN, neutral: DASH }[direction];
  return <Svg>{shape}</Svg>;
}

export function MissingIcon({ kind }: { kind: "couldnt_check" | "not_published" }) {
  return kind === "couldnt_check" ? (
    <Svg>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ) : (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M6 18L18 6" />
    </Svg>
  );
}

export function ArrowIcon() {
  return (
    <Svg>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

function Chevron() {
  return (
    <Svg className="icon--chevron">
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

// ---- Collapsible section ----

export function Collapsible({
  title,
  level = 2,
  children,
}: {
  title: ReactNode;
  level?: 2 | 3;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={`collapsible collapsible--h${level}`}>
      <Heading className="collapsible-heading">
        <button
          type="button"
          className="collapsible-button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{title}</span>
          <Chevron />
        </button>
      </Heading>
      <div id={id} className="collapsible-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

// ---- Look-alike domains, side by side ----

function Marked({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.changed ? (
          <mark key={i} className="diff-mark">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function DomainCompare({ sender, imitates }: { sender: string; imitates: string }) {
  const diff = diffDomains(sender, imitates);
  const id = useId();
  return (
    <figure className="compare" aria-labelledby={id}>
      <figcaption id={id} className="compare-title">
        {RESULT.lookalikeHeading}
      </figcaption>
      <dl className="compare-grid">
        <div className="compare-cell">
          <dt>{RESULT.lookalikeSender}</dt>
          <dd className="mono">
            <Marked segments={diff.sender} />
          </dd>
        </div>
        <div className="compare-cell">
          <dt>{RESULT.lookalikeCompany}</dt>
          <dd className="mono">
            <Marked segments={diff.official} />
          </dd>
        </div>
      </dl>
      <p className="compare-desc">{diff.description}</p>
    </figure>
  );
}
