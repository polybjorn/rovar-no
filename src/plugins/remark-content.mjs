import { visit } from 'unist-util-visit';
import { media } from '../data/media.js';
import { facts } from '../data/facts.js';
import { seasonStrings } from '../i18n/season-format.js';

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
    const values = { ...facts, ...(locale ? seasonStrings(locale) : {}) };

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
