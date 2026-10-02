// Whether the daily scheduled deploy still has a feed to refresh (#88). The
// schedule exists for the .ics feeds alone, and they retire on
// FEED_RETIRE_DATE; past that and a short grace the scheduled run stops
// building, while a push or a manual run always builds. deploy.yml reads
// `build=true|false` from $GITHUB_OUTPUT.
import { appendFileSync } from 'node:fs';
import { feedScheduleWanted } from '../src/scripts/departures-core.js';

const build = process.env.GITHUB_EVENT_NAME !== 'schedule' || feedScheduleWanted();
const line = `build=${build}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
process.stdout.write(line);
