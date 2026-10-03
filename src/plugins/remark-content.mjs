import { createHash } from 'node:crypto';
import { visit } from 'unist-util-visit';
import { media } from '../data/media.js';
import { facts } from '../data/facts.js';
import { seasonStrings, lastDayIn, firstDayIn, hoursIn, departuresIn, formatClock } from '../i18n/season-format.js';
import { localeInfo } from '../i18n/locales.js';
import { daysIn } from '../i18n/weekdays.js';
import { phoneStrings } from '../i18n/phone-format.js';
import { pages } from '../i18n/pages.js';
import { pageLinks } from '../i18n/routes-core.js';
import { locales } from '../i18n/locales.js';

const pageByKey = Object.fromEntries(pages.map((p) => [p.key, p]));

// A hash of every value the placeholders can resolve to, for astro.config.mjs.
// Astro caches rendered markdown by the markdown alone, so a changed fact or
// season date needs a changed config to reach the pages.
export function contentDigest() {
  const values = locales.map(({ code }) => [code, seasonStrings(code), phoneStrings(code)]);
  return createHash('sha256').update(JSON.stringify([facts, media, values])).digest('hex');
}

const localeOf = (file) => file?.path?.match(/[/\\]pages[/\\]([^/\\]+)[/\\]/)?.[1];
const pageOf = (file) => file?.path?.match(/[/\\]pages[/\\][^/\\]+[/\\]([^/\\]+)\.md$/)?.[1];

// Turns the conveniences content files rely on into real markdown:
//
//   {{end}}, {{havbrukPhone}} -> seasonal value or shared fact
//   {{historyPage}}           -> link to another page in the same language
//   ![Alt](sykkel)            -> ![Alt](../../../assets/Sykkel-500x334.jpg)
//
// All of it is language-independent, so a translator copies a file, rewrites
// the prose, and the dates, numbers and photos keep working.
export function remarkContent() {
  return (tree, file) => {
    const locale = localeOf(file);
    const page = pageOf(file);
    const values = locale
      ? {
          ...facts,
          ...seasonStrings(locale),
          ...phoneStrings(locale),
          ...(page in pageByKey ? pageLinks(pageByKey, locale, page) : {}),
        }
      : { ...facts };

    const fill = (value, node) =>
      value.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
        if (key in values) return values[key];
        file.message(`Unknown placeholder {{${key}}}`, node);
        return whole;
      });

    // A list row that names a seasonal date carries the last day it covers,
    // so the page can strike it through once that day is past
    // (scripts/past-hours.js). Read before the placeholders are filled in.
    //
    // One that names opening hours, dated or all year, is an hours row, and carries its
    // days, first day and hours too, so the page can say whether the place
    // is open now. Its days come from its label, and a label that cannot be
    // read fails the build: guessing would show a wrong status.
    //
    // One that names departures carries its times instead, so the page can
    // say when the next one leaves. Its label is "Avganger:", so it has to
    // say "hver dag" in its text, the only days it can name for now.
    visit(tree, 'listItem', (node) => {
      const text = [];
      visit(node, 'text', (t) => {
        text.push(t.value);
      });
      const joined = text.join(' ');
      const until = lastDayIn(joined);
      const hours = locale && hoursIn(joined);
      const departures = locale && departuresIn(joined);
      if (!until && !hours && !departures) return;
      const props = until ? { dataUntil: until } : {};

      if (hours) {
        const strong = node.children[0]?.children?.find((c) => c.type === 'strong');
        const label = strong?.children?.map((c) => c.value ?? '').join('') ?? '';
        const days = daysIn(label, locale);
        if (!days) file.fail(`Hours row with a label naming no days this can read: "${label}"`, node);
        Object.assign(props, {
          dataDays: days.join(','),
          dataFrom: firstDayIn(joined),
          dataOpen: hours[0],
          dataClose: hours[1],
          dataOpenText: formatClock(locale, hours[0]),
          dataCloseText: formatClock(locale, hours[1]),
        });
      }
      if (departures) {
        const every = localeInfo(locale).days?.every;
        if (!every || !joined.toLocaleLowerCase().includes(every)) {
          file.fail(`Departures row that does not say "${every}": "${joined}"`, node);
        }
        Object.assign(props, {
          dataDays: '0,1,2,3,4,5,6',
          dataFrom: firstDayIn(joined),
          dataDepartures: departures.join(','),
          dataDepartureTexts: departures.map((time) => formatClock(locale, time)).join(','),
        });
      }
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, ...props } };
    });

    visit(tree, 'text', (node) => {
      node.value = fill(node.value, node);
    });

    // Placeholders work in link targets too: [{{havbrukEmail}}](mailto:{{havbrukEmail}})
    visit(tree, 'link', (node) => {
      node.url = fill(node.url, node);
    });

    visit(tree, 'image', (node) => {
      if (node.url in media) node.url = `../../../assets/${media[node.url]}`;
      else if (!node.url.startsWith('.')) file.message(`Unknown media key "${node.url}"`, node);
    });
  };
}
