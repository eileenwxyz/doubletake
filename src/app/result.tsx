"use client";

import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CheckReport, Direction, Reason } from "@/lib/check/types";
import {
  COULDNT_FIND_LABELS,
  DIRECTION_LABELS,
  HEADINGS,
  RESULT,
  SOURCE_TYPE_LABELS,
  VERDICT_LABELS,
} from "@/lib/copy";
import {
  citedSources,
  formatCheckedAt,
  groupReasons,
  groupSources,
  shortUrl,
} from "@/lib/present";
import {
  ArrowIcon,
  Collapsible,
  DirectionIcon,
  DomainCompare,
  MissingIcon,
  Mono,
  VerdictIcon,
  WithDomains,
} from "./ui";

export default function Result({
  report,
  isExample,
  onNotThisOne,
}: {
  report: CheckReport;
  isExample: boolean;
  onNotThisOne: () => void;
}) {
  const verdictRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();
  const subtitleId = `${ids}-subtitle`;
  const noteId = `${ids}-note`;

  // Move focus to the verdict when a result loads, so it is announced.
  useEffect(() => {
    verdictRef.current?.focus();
  }, [report]);

  const cited = citedSources(report.reasons);
  const groups = groupSources(report.sources);
  const topGroups = groupReasons(report.reasons, report.verdict);
  const allGroups = report.allReasons ? groupReasons(report.allReasons, report.verdict) : [];
  const allGroupId = (direction: Direction) => `${ids}-all-${direction}`;

  // "+N more reasons" opens "See all sources" and scrolls to that group.
  const [allOpen, setAllOpen] = useState(false);
  const showAllReasons = (direction: Direction) => {
    // Render the opened section first, so the group exists to scroll to.
    flushSync(() => setAllOpen(true));
    const target = document.getElementById(allGroupId(direction));
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  };

  return (
    <article className="result" aria-label={report.companyName}>
      {/* 1. Header */}
      <header className="result-head">
        {isExample && <p className="badge">{RESULT.example}</p>}
        <h1 className="company">{report.companyName}</h1>
        {report.job?.site && (
          <p className="result-meta posted-on">
            <WithDomains text={RESULT.postedOn(report.job.site)} />
          </p>
        )}
        {report.officialDomain && (
          <p className="company-domain">
            <Mono>{report.officialDomain}</Mono>
          </p>
        )}
        <p className="result-meta">
          <time dateTime={report.checkedAt}>
            {RESULT.checkedAt(formatCheckedAt(report.checkedAt))}
          </time>
          <span aria-hidden="true"> · </span>
          <button type="button" className="text-button" onClick={onNotThisOne}>
            {RESULT.notThisOne}
          </button>
        </p>
      </header>

      {/* 2. Verdict */}
      <section className={`verdict verdict--${report.verdict}`}>
        <h2
          ref={verdictRef}
          tabIndex={-1}
          className="verdict-label"
          aria-describedby={`${report.subtitle ? subtitleId : ""} ${noteId}`.trim()}
        >
          <VerdictIcon verdict={report.verdict} />
          <span>{VERDICT_LABELS[report.verdict]}</span>
        </h2>
        {report.subtitle && (
          <p id={subtitleId} className="verdict-subtitle">
            {report.subtitle}
          </p>
        )}
        <p id={noteId} className="verdict-note">
          {RESULT.disclaimer}
        </p>
      </section>

      {/* 3. Primary next step */}
      {report.nextStep && (
        <a className="next-step" href={report.nextStep.url} rel="noopener noreferrer">
          <span className="next-step-kicker">{RESULT.nextStepLabel}</span>
          <span className="next-step-label">
            {RESULT.nextStep[report.nextStep.kind](report.companyName)}
            <ArrowIcon />
          </span>
          <span className="next-step-url">
            <Mono>{shortUrl(report.nextStep.url)}</Mono>
          </span>
        </a>
      )}

      {/* 4. The company says */}
      {report.companySays && (
        <section className="section">
          <h2 className="section-heading">{HEADINGS.companySays}</h2>
          <figure className="quote">
            <blockquote>
              <p>
                <WithDomains text={report.companySays.quote} />
              </p>
            </blockquote>
            <figcaption className="quote-source">
              <WithDomains text={RESULT.companySaysFrom(report.companySays.domain)} />
            </figcaption>
          </figure>
        </section>
      )}

      {/* 5. Top reasons */}
      {report.reasons.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-heading">{RESULT.topReasons}</h2>
            <p className="section-count">{RESULT.sourcesCount(cited, report.sources.length)}</p>
          </div>
          {report.lookalike && (
            <DomainCompare sender={report.lookalike.sender} imitates={report.lookalike.imitates} />
          )}
          {topGroups.map((group) => {
            const more = allGroups.length ? report.moreReasons?.[group.direction] ?? 0 : 0;
            return (
              <div key={group.direction} className="reason-group">
                <h3 className="reason-group-heading">
                  <DirectionIcon direction={group.direction} />
                  <span>{DIRECTION_LABELS[group.direction]}</span>
                </h3>
                <ul className="reasons">
                  {group.reasons.map((reason, index) => (
                    <ReasonItem
                      key={index}
                      reason={reason}
                      maxLinks={MAX_REASON_LINKS}
                      onShowAll={
                        allGroups.length ? () => showAllReasons(group.direction) : undefined
                      }
                    />
                  ))}
                </ul>
                {more > 0 && (
                  <button
                    type="button"
                    className="text-button more-reasons"
                    onClick={() => showAllReasons(group.direction)}
                  >
                    {RESULT.moreReasons(more)}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* 6. What we couldn't find */}
      {report.couldntFind.length > 0 && (
        <section className="section">
          <h2 className="section-heading">{RESULT.couldntFind}</h2>
          <ul className="missing-list">
            {report.couldntFind.map((item, index) => (
              <li key={index} className="missing">
                <span className={`tag tag--${item.kind}`}>
                  <MissingIcon kind={item.kind} />
                  {COULDNT_FIND_LABELS[item.kind]}
                </span>
                <span className="missing-text">
                  <WithDomains text={item.text} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 7. What to do next */}
      <section className="section">
        <h2 className="section-heading">{RESULT.whatNext}</h2>
        {report.senderDomain && (
          <p className="tip">
            <WithDomains text={RESULT.replyToTip(report.senderDomain)} />
          </p>
        )}
        <Collapsible title={RESULT.checkYourself} level={3}>
          <ul className="bullets">
            {RESULT.checkYourselfItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Collapsible>
      </section>

      {/* 8. See all sources */}
      {(groups.length > 0 || allGroups.length > 0) && (
        <Collapsible title={RESULT.allSources} open={allOpen} onOpenChange={setAllOpen}>
          {allGroups.length > 0 && (
            <>
              <h3 className="all-sources-heading">{RESULT.allReasonsHeading}</h3>
              {allGroups.map((group) => (
                <div key={group.direction} className="source-group">
                  <h4 id={allGroupId(group.direction)} tabIndex={-1} className="source-group-heading">
                    {RESULT.sourceGroup(DIRECTION_LABELS[group.direction], group.reasons.length)}
                  </h4>
                  <ul className="reasons">
                    {group.reasons.map((reason, index) => (
                      <ReasonItem key={index} reason={reason} />
                    ))}
                  </ul>
                </div>
              ))}
              {groups.length > 0 && (
                <h3 className="all-sources-heading">{RESULT.allSourcesHeading}</h3>
              )}
            </>
          )}
          {groups.map((group) => {
            const Heading = allGroups.length > 0 ? "h4" : "h3";
            return (
              <div key={group.type} className="source-group">
                <Heading className="source-group-heading">
                  {RESULT.sourceGroup(SOURCE_TYPE_LABELS[group.type], group.sources.length)}
                </Heading>
                <ul className="source-list">
                  {group.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} rel="noopener noreferrer" className="source-link">
                        <Mono>{shortUrl(source.url)}</Mono>
                      </a>
                      {source.publishDate && (
                        <span className="source-date"> · {source.publishDate.slice(0, 10)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </Collapsible>
      )}

      {/* 9. How we checked */}
      <Collapsible title={RESULT.howWeChecked}>
        {report.searches.length > 0 ? (
          <>
            <p>{RESULT.searchesIntro}</p>
            <ol className="searches">
              {report.searches.map((query) => (
                <li key={query}>
                  <q>
                    <WithDomains text={query} />
                  </q>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>{RESULT.noSearches}</p>
        )}
      </Collapsible>
    </article>
  );
}

// Under Top reasons, a merged reason shows this many source links, then
// "and N more", which opens "See all sources" where every link is listed.
const MAX_REASON_LINKS = 3;

// One reason: its sentence, then the type, age and link of each source it
// cites (a merged reason cites several). With maxLinks and onShowAll, links
// past maxLinks are replaced by an "and N more" button.
function ReasonItem({
  reason,
  maxLinks,
  onShowAll,
}: {
  reason: Reason;
  maxLinks?: number;
  onShowAll?: () => void;
}) {
  const all = [
    { url: reason.sourceUrl, sourceType: reason.sourceType, age: reason.age },
    ...(reason.alsoFrom ?? []),
  ];
  const cap = maxLinks !== undefined && onShowAll && all.length > maxLinks ? maxLinks : all.length;
  const sources = all.slice(0, cap);
  const hidden = all.length - cap;
  return (
    <li className={`reason reason--${reason.direction}`}>
      <p className="reason-text">
        <WithDomains text={reason.text} />
      </p>
      {sources.map((source, index) => (
        <p key={index} className="reason-meta">
          <span>{SOURCE_TYPE_LABELS[source.sourceType]}</span>
          <span aria-hidden="true"> · </span>
          <span>{source.age}</span>
          <span aria-hidden="true"> · </span>
          {source.url ? (
            <a href={source.url} rel="noopener noreferrer" className="source-link">
              <Mono>{shortUrl(source.url)}</Mono>
            </a>
          ) : (
            <span>{RESULT.noSourceLink}</span>
          )}
        </p>
      ))}
      {hidden > 0 && (
        <p className="reason-meta">
          <button type="button" className="text-button" onClick={onShowAll}>
            {RESULT.moreLinks(hidden)}
          </button>
        </p>
      )}
    </li>
  );
}
