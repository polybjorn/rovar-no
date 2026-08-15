// The links gathered in the footer, in one place on every page. They also stay
// inline in the page copy where the text needs them - this list is a second way
// to the same destinations, not a replacement.
//
// Every URL here must be the same in every language: labels come from
// `chrome.links.<key>` in the UI catalogs, the URL does not. A destination with
// a per-language address (Fjord Norway, for one) stays in the content file.
import { facts } from './facts.js';

export const footerLinks = [
  { key: 'havhotell', url: facts.havhotellUrl },
  { key: 'sjohus', url: facts.sjohusFacebookUrl },
  { key: 'havbruk', url: facts.havbrukUrl },
  { key: 'kolumbus', url: facts.kolumbusBookingUrl },
  { key: 'avis', url: facts.avisSearchUrl },
];
