import { toOsloDate } from './departures-core.js';
import { pastState } from './past-hours-core.js';

// Strikes through the hours rows whose dates are over (data-until, set from
// the season data by remark-content), and once every dated row in a list is
// over, says so under it. Done in the browser so a page built in July is
// still right in October without a rebuild.
const note = document.body.dataset.pastNote;
const today = toOsloDate(new Date());

for (const list of document.querySelectorAll('.fact-list')) {
  const rows = [...list.querySelectorAll(':scope > li[data-until]')];
  const { past, allPast } = pastState(rows.map((row) => row.dataset.until), today);
  rows.forEach((row, i) => row.classList.toggle('past', past[i]));
  if (allPast && note) {
    const p = document.createElement('p');
    p.className = 'fact-past-note';
    p.textContent = note;
    list.after(p);
  }
}
