// Details that appear inside page copy in every language: phone numbers, email
// addresses, prices and links to other sites. Written once here, referenced
// from content files and UI strings as {{placeholders}}.
//
// The point is not saving keystrokes. A phone number spelled out in 15
// translations gets updated in 11 of them, and the other 4 serve a dead number
// for a year without anyone noticing.
//
// Only put something here if it is identical in every language. Links that
// differ per language (the Fjord Norway pages, for instance) stay in the
// content files.

export const facts = {
  oytingEmail: 'rovaroyting@rovar.no',

  // Røvær Havbrukssenter
  havbrukUrl: 'https://rovarhavbrukssenter.no/',
  havbrukEmail: 'post@rovarhavbrukssenter.no',
  havbrukPhone: '960 94 450',

  // RIB tour to the salmon pens
  ribPriceAdult: '100 kr',
  ribPriceChild: '50 kr',

  // Røvær Sjøhus
  sjohusFacebookUrl: 'https://www.facebook.com/RovaerSjohus',

  // Røvær Havhotell
  havhotellUrl: 'https://rovarhavhotell.no/',
  havhotellMenuUrl: 'https://rovarhavhotell.no/meny/',
  havhotellFacebookUrl: 'https://www.facebook.com/rovarkulturhotell',
  havhotellEmail: 'kontakt@rovarhavhotell.no',
  havhotellPhone: '52 71 58 00',

  // Leirskolen
  campSchoolEmail: 'espen.martens@haugesund.kommune.no',
  campSchoolPhone: '992 52 179',

  // Haugesunds Avis, the local paper: a search rather than a tag page, so it
  // keeps working if they retire the tag
  avisSearchUrl: 'https://www.h-avis.no/sok?keyword=R%C3%B8v%C3%A6r',

  // Kolumbus, for the departure board
  ferryLine: '700',
  kolumbusPhone: '482 21 780',
  kolumbusBookingHost: 'billetter.kolumbus.no',
  kolumbusBookingUrl: 'https://billetter.kolumbus.no',
};
