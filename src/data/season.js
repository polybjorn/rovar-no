// Seasonal dates and opening hours for the explore page. Stored once, in
// machine-readable form, and formatted per language at build time
// (src/i18n/season.js). Edit here and every language follows - no clock times
// are retyped per language.
//
// Content files refer to these as {{placeholders}}, e.g. "frem til {{end}}".
// Dates are ISO, times are 24-hour "HH:MM" in Europe/Oslo. Ranges are pairs.

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
};
