// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { locales, defaultLocale } from './src/i18n/locales.js';
import { remarkContent } from './src/plugins/remark-content.mjs';
import { rehypeStructure } from './src/plugins/rehype-structure.mjs';

// Preview deployment on GitHub Pages. At launch: site back to
// 'https://rovar.no' and drop `base` (links go through routes/BASE_URL,
// so no other change is needed). Preview builds also skip the sitemap and
// carry a noindex meta (Layout.astro), both keyed on this check.
const site = 'https://polybjorn.github.io';
const isPreview = !site.includes('rovar.no');

// https://astro.build/config
export default defineConfig({
  site,
  base: '/rovar-no',
  integrations: isPreview ? [] : [
    sitemap({
      filter: (page) => !page.includes('/404'),
      i18n: {
        defaultLocale,
        // Derived from src/i18n/locales.js, like everything else per language.
        locales: Object.fromEntries(locales.map((l) => [l.code, l.intl])),
      },
    }),
  ],
  image: {
    // Photos in content markdown carry no sizing props, so give them a
    // responsive layout by default; the hand-placed <Image> tags opt out with
    // layout="none" and keep their own widths/sizes.
    layout: 'constrained',
    // Caps the srcset the browser may pick from for those images.
    service: { entrypoint: './src/plugins/image-service.mjs' },
  },
  markdown: {
    // Page copy is the original rovar.no text, restored verbatim. Leave its
    // punctuation alone rather than letting smart quotes rewrite it.
    smartypants: false,
    // Content files use {{season}} placeholders and photo keys, and get their
    // page structure from heading levels. See src/plugins/.
    remarkPlugins: [remarkContent],
    rehypePlugins: [rehypeStructure],
  },
  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // adjacent inline elements. That silently closed the gaps around the
  // separator on the rutebaten credit line ("minutt.|Se ruter pa Kolumbus")
  // while the build still reported success. Keep the pre-7 behaviour rather
  // than hand-placing {" "} at every affected boundary.
  compressHTML: true,
});
