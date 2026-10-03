// Seasonal dates and opening hours for the explore page. Stored once, in
// machine-readable form, and formatted per language at build time
// (src/i18n/season.js). Edit here and every language follows - no clock times
// are retyped per language.
//
// Content files refer to these as {{placeholders}}, e.g. "frem til {{end}}".
// Dates are ISO, times are 24-hour "HH:MM" in Europe/Oslo. Ranges are pairs,
// a single time is a string.
//
// Where each place publishes its hours, for the yearly update (README,
// "Updating dates and hours"; npm run season:check says when):
//   Røvær Sjøhus and the RIB tour: the Sjøhus Facebook page, or
//     Havbrukssenteret (facts.js has the email and phone)
//   Røvær Havhotell: rovarhavhotell.no, and its Facebook page
//   Hiltahuset: haugalandmuseet.no/museum/hiltahuset

export const season = {
  year: 2026,
  end: '2026-08-16',
  ribDepartures: ['11:30', '14:15'],
  sjohusSummer: ['11:00', '16:00'],
  sjohusAutumn: ['11:00', '15:00'],
  hotelSunWed: ['12:00', '20:00'],
  hotelSunWedFood: ['12:30', '19:00'],
  hotelThuSat: ['12:00', '21:00'],
  hotelThuSatFood: ['12:30', '20:00'],
  hotelAutumn: ['12:00', '16:30'],
  // Weekends after the summer season, for Sjøhus and the Havhotell restaurant.
  autumn: ['2026-08-17', '2026-09-30'],
  // Hiltahuset: Sundays and Thursdays through the summer holiday. These are
  // the museum's dates for summer 2027 (haugalandmuseet.no, 2026-10-02).
  hiltaSeason: ['2027-06-20', '2027-08-29'],
  hiltaHours: ['13:30', '15:30'],
  // Nærbutikken Røvær, every day all year. Not seasonal, but hours on the
  // same page, so written the same way as the others. 24:00 is midnight as a
  // closing time, so it sorts after the opening.
  narbutikkenHours: ['05:45', '24:00'],
};
