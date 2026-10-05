// The site's pages. `slug` is the URL segment used by every language except
// those listed in `slugs`. Norwegian keeps the original rovar.no slugs, so it
// is the only entry with overrides.
export const pages = [
  { key: 'home',        slug: '',            slugs: {} },
  { key: 'explore',     slug: 'explore',     slugs: { no: 'opplev-oya-var' } },
  { key: 'ferry',       slug: 'ferry',       slugs: { no: 'rutebaten' } },
  { key: 'camp-school', slug: 'camp-school', slugs: { no: 'leirskolen' } },
  { key: 'history',     slug: 'history',     slugs: { no: 'rovaers-historie' } },
];
