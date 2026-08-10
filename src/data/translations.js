export const t = {
  no: {
    navExplore: "Opplev øya",
    navFerry: "Rutebåten",
    navCampSchool: "Leirskolen",
    navHistory: "Historie",
    skipLink: "Hopp til innhold",
    menuLabel: "Meny",
    langLabel: "Velg språk",
    footerHeading: "Kontakt",
    footerPre: "Har du lyst til å komme i kontakt med noen på Røvær? Ta kontakt med",
    footerPost: "– så skal vi hjelpe deg så godt vi kan.",
  },
  en: {
    navExplore: "Explore",
    navFerry: "Ferry",
    navCampSchool: "Camp school",
    navHistory: "History",
    skipLink: "Skip to content",
    menuLabel: "Menu",
    langLabel: "Choose language",
    footerHeading: "Contact",
    footerPre: "Would you like to get in touch with someone on Røvær? Contact",
    footerPost: "– and we will help you as best we can.",
  },
  de: {
    navExplore: "Entdecken",
    navFerry: "Fähre",
    navCampSchool: "Schullandheim",
    navHistory: "Geschichte",
    skipLink: "Zum Inhalt springen",
    menuLabel: "Menü",
    langLabel: "Sprache wählen",
    footerHeading: "Kontakt",
    footerPre: "Möchten Sie mit jemandem auf Røvær in Kontakt treten? Schreiben Sie an",
    footerPost: "– wir helfen Ihnen so gut wir können.",
  },
};

// BASE_URL is "/" at rovar.no and "/rovar-no" on the GitHub Pages preview.
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export const routes = {
  home:       { no: `${base}/`,                  en: `${base}/en/`,              de: `${base}/de/` },
  explore:    { no: `${base}/opplev-oya-var/`,   en: `${base}/en/explore/`,      de: `${base}/de/explore/` },
  ferry:      { no: `${base}/rutebaten/`,        en: `${base}/en/ferry/`,        de: `${base}/de/ferry/` },
  campSchool: { no: `${base}/leirskolen/`,       en: `${base}/en/camp-school/`,  de: `${base}/de/camp-school/` },
  history:    { no: `${base}/rovaers-historie/`, en: `${base}/en/history/`,      de: `${base}/de/history/` },
};

export const langLabels = {
  no: "Norsk",
  en: "English",
  de: "Deutsch",
};
