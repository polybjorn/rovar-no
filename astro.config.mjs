// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://rovar.no',
  // Astro 7 changed the default to 'jsx', which strips whitespace between
  // adjacent inline elements. That silently closed the gaps around the
  // separator on the rutebaten credit line ("minutt.|Se ruter pa Kolumbus")
  // while the build still reported success. Keep the pre-7 behaviour rather
  // than hand-placing {" "} at every affected boundary.
  compressHTML: true,
});
