// @ts-check
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { locales, defaultLocale } from './src/i18n/locales.js';
import { remarkContent, contentDigest } from './src/plugins/remark-content.mjs';
import { rehypeStructure } from './src/plugins/rehype-structure.mjs';
import { rehypeNbsp } from './src/plugins/rehype-nbsp.mjs';

// Preview deployment on GitHub Pages. At launch: site back to
// 'https://rovar.no' and drop `base` (links go through routes/BASE_URL,
// so no other change is needed). Preview builds also skip the sitemap and
// carry a noindex meta (Layout.astro), both keyed on this check.
// LAUNCH_SITE builds the launch state ahead of time, so tools/site-compare can
// check the sitemap and indexing the preview leaves out.
const site = process.env.LAUNCH_SITE ?? 'https://polybjorn.github.io';
const isPreview = !site.includes('rovar.no');
const base = process.env.PREVIEW_BASE ?? '/rovar-no';

// The content digest covers the values the placeholders resolve to; this one
// covers the plugins themselves, so an edit to one reaches a plain build
// instead of the cached markdown.
const plugins = new URL('./src/plugins/', import.meta.url);
const pluginsDigest = createHash('sha256')
  .update(readdirSync(plugins).sort().map((f) => readFileSync(new URL(f, plugins), 'utf8')).join('\0'))
  .digest('hex');

// https://astro.build/config
export default defineConfig({
  site,
  // A branch preview on the fleet's site-preview server lands on a subpath of
  // its own; scripts/build-preview.mjs sets this to match. Unset, the build is
  // the deploy build.
  base,
  // The old site's language pages sat at /english/ and /deutch/, which search
  // results and other sites still link to; Astro writes each as an instant
  // meta refresh, which Google follows as a redirect.
  redirects: Object.fromEntries(locales.filter((l) => l.oldSlug)
    .map((l) => [`/${l.oldSlug}`, `${base.replace(/\/$/, '')}/${l.code}/`])),
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
    // The plugin ignores the digest. Astro hashes this config and clears its
    // content cache when the hash changes, and without it an edit to facts.js
    // or season.js leaves cached pages showing the old value.
    remarkPlugins: [[remarkContent, { digest: contentDigest() }]],
    rehypePlugins: [rehypeStructure, [rehypeNbsp, { digest: pluginsDigest }]],
  },
  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // adjacent inline elements. That silently closed the gaps around the
  // separator on the rutebaten credit line ("minutt.|Se ruter pa Kolumbus")
  // while the build still reported success. Keep the pre-7 behaviour rather
  // than hand-placing {" "} at every affected boundary.
  compressHTML: true,
  vite: {
    // Astro inlines small hoisted scripts into the HTML, which the CSP in
    // Layout.astro (script-src 'self') then blocks. Keep every script an
    // external file.
    build: { assetsInlineLimit: 0 },
  },
});
