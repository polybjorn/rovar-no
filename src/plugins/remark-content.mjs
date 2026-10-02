import { createHash } from 'node:crypto';
import { visit } from 'unist-util-visit';
import { media } from '../data/media.js';
import { facts } from '../data/facts.js';
import { seasonStrings } from '../i18n/season-format.js';
import { phoneStrings } from '../i18n/phone-format.js';
import { locales } from '../i18n/locales.js';

// A hash of every value the placeholders can resolve to, for astro.config.mjs.
// Astro caches rendered markdown by the markdown alone, so a changed fact or
// season date needs a changed config to reach the pages.
export function contentDigest() {
  const values = locales.map(({ code }) => [code, seasonStrings(code), phoneStrings(code)]);
  return createHash('sha256').update(JSON.stringify([facts, media, values])).digest('hex');
}

const localeOf = (file) => file?.path?.match(/[/\\]pages[/\\]([^/\\]+)[/\\]/)?.[1];

// Turns the conveniences content files rely on into real markdown:
//
//   {{end}}, {{havbrukPhone}} -> seasonal value or shared fact
//   ![Alt](sykkel)            -> ![Alt](../../../assets/Sykkel-500x334.jpg)
//
// All of it is language-independent, so a translator copies a file, rewrites
// the prose, and the dates, numbers and photos keep working.
export function remarkContent() {
  return (tree, file) => {
    const locale = localeOf(file);
    const values = locale
      ? { ...facts, ...seasonStrings(locale), ...phoneStrings(locale) }
      : { ...facts };

    const fill = (value, node) =>
      value.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
        if (key in values) return values[key];
        file.message(`Unknown placeholder {{${key}}}`, node);
        return whole;
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
