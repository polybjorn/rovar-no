import sharpService from 'astro/assets/services/sharp';

// Photos in content markdown carry no sizing props, so Astro assumes they may
// fill the viewport and offers srcset candidates up to the source width. They
// never do: they render in the article column. Without this the browser
// downloads a 1920px file for a 672px slot.
const CONTENT_SIZES = '(max-width: 768px) 100vw, 672px';

export default {
  ...sharpService,
  getHTMLAttributes(options, config) {
    const attrs = sharpService.getHTMLAttributes(options, config);
    if (options.layout === 'constrained' && attrs.sizes) attrs.sizes = CONTENT_SIZES;
    return attrs;
  },
};
