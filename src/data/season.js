// Seasonal dates and opening hours for the explore page. Stored once, in
// machine-readable form, and formatted per language at build time
// (src/i18n/season.js). Edit here and every language follows - no clock times
// are retyped per language.
//
// Content files refer to these as {{placeholders}}, e.g. "frem til {{end}}".
// Dates are ISO, times are 24-hour "HH:MM" in Europe/Oslo. Ranges are pairs,
// a single time is a string.

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
  // Hiltahuset: Sundays and Thursdays through the summer holiday. These are
  // the museum's dates for summer 2027 (haugalandmuseet.no, 2026-10-02).
  hiltaOpens: '2027-06-20',
  hiltaCloses: '2027-08-29',
  hiltaHours: ['13:30', '15:30'],
  // Nærbutikken Røvær, every day until midnight. Not seasonal, but a clock
  // time on the same page, so it is written the same way as the others.
  narbutikkenOpens: '05:45',
};
