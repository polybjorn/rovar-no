import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One folder per language, one file per page: src/content/pages/<lang>/<page>.md
// The file name is the page key from src/i18n/routes.js, not the URL slug, so
// the same file name means the same page in every language.
const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '*/*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    // Set by the translation scaffold; drives the review banner. Remove the
    // line once a human has read the page through.
    machineTranslated: z.boolean().default(false),
    // Home page only.
    hero: z.object({ heading: z.string(), text: z.string() }).optional(),
    cards: z
      .record(z.object({ heading: z.string(), text: z.string(), alt: z.string() }))
      .optional(),
    mapLink: z.string().optional(),
    mapAlt: z.string().optional(),
  }),
});

export const collections = { pages };
