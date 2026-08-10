// Structure of the homepage card grid: which page each card links to, which
// photo it uses, and load priority. Language-independent - the text and alt
// text come from src/content/pages/<lang>/home.md.
export const homeCards = [
  { page: 'explore',     image: 'jenter',     loading: 'eager' },
  { page: 'ferry',       image: 'hurtigbat',  loading: 'eager' },
  { page: 'camp-school', image: 'hotell',     loading: 'lazy' },
  { page: 'history',     image: 'suggevagen', loading: 'lazy' },
];

export const mapUrl = 'https://www.openstreetmap.org/#map=14/59.43816/5.09139';
