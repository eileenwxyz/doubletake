// Staffing agencies: spotting an agency, the client a posting says it is
// recruiting for, and whether a sender's domain is an agency's own site.

import { compactName, domainLabel, registrableDomain } from "./domains";
import { findOfficialDomain } from "./official";
import { plainText, properNameFromTitles } from "./text";
import type { SearchHit } from "./types";

const AGENCY_NAME =
  /\b(staffing|recruit\w*|talent|personnel|placements?|search|agency|workforce|resourcing|headhunt\w*)\b/i;
const AGENCY_TEXT =
  /\b(staffing (agency|firm|company|partner)|recruit(ment|ing) (agency|firm|company|partner|consultancy)|employment agency|placement (agency|firm)|talent (agency|partner|solutions firm)|headhunters?|executive search firm)\b/i;
const HIDDEN_CLIENT =
  /\b(confidential|undisclosed|unnamed|anonymous) (client|company|employer)\b|\bclient(?:'s)?(?: name)? (?:is|will be|remains|must remain) (?:kept )?(?:confidential|undisclosed)\b/i;
// "a client", "our client", "one of our clients", with up to a few words
// between ("our client, a leading insurer"). Checked separately for a name
// right after it.
const SOME_CLIENT = /\b(?:(?:a|an|our)\b[^.\n]{0,40}?\bclient\b|one of our\b[^.\n]{0,40}?\bclients\b)/giu;
// The client's name right after "our client": "Our client, Globex Corp, is
// hiring". Up to five capitalised words.
const CLIENT_NAME =
  /^\s*[,:(–-]?\s*(\p{Lu}[\p{L}\p{N}&'.-]*(?:[ \t]+(?:&[ \t]+)?\p{Lu}[\p{L}\p{N}&'.-]*){0,4})/u;
// First-person client wording is an agency signal on its own, whatever the
// poster's name ("Northwind Group ... our client is seeking"). "a client"
// alone is not: employers support clients too.
const FIRST_PERSON_CLIENT = /\b(?:our client\b(?!s)|one of our clients\b)/i;

// The name, or the words of its posting or its own site, say this is a
// staffing agency.
export function looksLikeAgency(name: string, text: string): boolean {
  const flat = plainText(text);
  return AGENCY_NAME.test(name) || AGENCY_TEXT.test(flat) || FIRST_PERSON_CLIENT.test(flat);
}

export type AgencyClient = {
  // The client the posting names, or null when it doesn't name one.
  client: string | null;
};

// For a posting by a staffing agency (see looksLikeAgency) that says the
// job is for a client: the client's name, or null when it isn't named.
// Null overall when the poster isn't an agency or the posting doesn't say
// the job is for a client.
export function agencyClient(poster: string, text: string): AgencyClient | null {
  if (!looksLikeAgency(poster, text)) return null;
  const flat = plainText(text);
  let unnamed = HIDDEN_CLIENT.test(flat);
  for (const match of flat.matchAll(SOME_CLIENT)) {
    const after = flat.slice((match.index ?? 0) + match[0].length);
    const name = CLIENT_NAME.exec(after)?.[1]?.replace(/[.,'-]+$/, "").trim();
    if (!name) {
      unnamed = true;
      continue;
    }
    if (compactName(name) !== "" && compactName(name) !== compactName(poster)) return { client: name };
  }
  return unnamed ? { client: null } : null;
}

// The poster is a staffing agency (its name, the posting or its own
// "our client" wording says so) and the posting says the job is for a
// client it doesn't name. "Our client, Acme Corp, ..." names the client and
// doesn't count.
export function forUnnamedClient(poster: string, text: string): boolean {
  return agencyClient(poster, text)?.client === null;
}

export type SenderAgency = {
  // The agency's name as its own pages write it.
  name: string;
  domain: string;
  // The sender's domain is confirmed as the agency's own site: a search
  // limited to it names the agency there, and its name or pages say it is
  // a staffing agency.
  confirmed: boolean;
  // The agency's page to cite.
  url: string | null;
  hits: SearchHit[];
};

// Whether the sender's own domain is a staffing agency's site, from a
// search limited to that domain. Null when nothing on the domain names a
// company, or nothing says it is an agency.
export function senderAgency(senderRoot: string, hits: readonly SearchHit[]): SenderAgency | null {
  const own = hits.filter((h) => registrableDomain(h.url) === senderRoot);
  if (own.length === 0) return null;
  const label = (domainLabel(senderRoot) ?? "").replace(/-/g, "");
  const name = properNameFromTitles(label, own.map((h) => h.title));
  if (!name) return null;
  const text = own.map((h) => `${h.title ?? ""}\n${h.text}`).join("\n");
  if (!looksLikeAgency(name, text)) return null;
  const found = findOfficialDomain(name, null, [...own]);
  return {
    name,
    domain: senderRoot,
    confirmed: found.status === "found" && found.domain === senderRoot,
    url: own[0]?.url ?? null,
    hits: own,
  };
}
