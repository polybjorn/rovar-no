// Photo keys used by content files, so translators never touch file names or
// import paths. In markdown: ![Alt text](natur). In frontmatter: image: jenter

export const media = {
  hero: 'rovar-frontpage.jpg',
  jenter: 'Jenter_forside_frontpage-1.jpg',
  hurtigbat: 'Bilde-Fjorled-JMT-1-e1593513975750.jpg',
  hotell: 'Hotell_Mork_frontpage.jpg',
  suggevagen: 'Suggevagen_frontpage.jpg',
  natur: 'Rvr_DSC6137_liten.jpg',
  havbruk: 'havbrukssenter.jpg',
  laksemerd: 'Helge-pa-merd.jpg',
  elever: 'Rvr_DSC0084-Edit.jpg',
  sjohus: 'Sjohus.jpg',
  sjosproyt: 'sjosproyt_2.jpg',
  kart: 'kart-rovar.png',
};

const files = import.meta.glob('../assets/*.{jpg,png}', { eager: true, import: 'default' });

// ImageMetadata for a key, for use with astro:assets.
export function asset(key) {
  const name = media[key];
  if (!name) throw new Error(`Unknown media key: ${key}`);
  const found = files[`../assets/${name}`];
  if (!found) throw new Error(`Media file missing: src/assets/${name}`);
  return found;
}
