// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

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
        defaultLocale: 'no',
        locales: { no: 'nb-NO', en: 'en-GB', de: 'de-DE' },
      },
    }),
  ],
  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // adjacent inline elements. That silently closed the gaps around the
  // separator on the rutebaten credit line ("minutt.|Se ruter pa Kolumbus")
  // while the build still reported success. Keep the pre-7 behaviour rather
  // than hand-placing {" "} at every affected boundary.
  compressHTML: true,
});
