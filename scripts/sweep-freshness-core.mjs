// The parts of the sweep-liveness check that touch no network, kept separate so
// test/sweep-freshness.test.mjs can cover them. Same split as
// merged-prs-core.mjs and link-check-core.mjs: the paging and the verdict are
// where the bugs are, and they are the half that can be tested without a forge.
//
// The question this answers: did the branch sweep actually run? The sweep in
// delete-merged-branch.yml is the backstop for a delete that the merge event
// never reached, and it has the same blind spot one layer up - if its timer
// stops firing, branches pile up in exactly the same silence, because the
// absence of a run looks like nothing to do. nixfleet's copy records that gap
// as knowingly accepted (its sweep-merged-branches.yml header). This closes it
// here instead, from merge-audit.yml, which already runs daily and already
// exists to make a silent failure loud.
//
// Deliberately not a second timer. A watchdog on its own schedule needs its own
// watchdog; folding the check into a job that runs anyway costs no runner slot
// and has nothing extra to keep alive.

// One page at a time, newest first, stopping as soon as no later page can hold
// anything we would accept. The listing is ordered by created_at descending, so
// once a page's oldest task predates the window, every task after it does too.
//
// maxPages is a real bound, not a formality: this repo's runner produces a
// handful of tasks per merge, so a busy day can push a daily sweep past the
// first page. Running out of pages is reported rather than swallowed - see the
// runner - because "no sweep found" and "stopped looking" are different facts
// and only one of them is a failure of the sweep.
export const collectTasks = async (getPage, { limit = 50, maxPages = 10, since = 0 } = {}) => {
  const tasks = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await getPage(page);
    tasks.push(...batch);
    if (batch.length < limit) return { tasks, complete: true, pages: page };
    const oldest = batch[batch.length - 1];
    if (startedAt(oldest) < since) return { tasks, complete: true, pages: page };
  }
  return { tasks, complete: false, pages: maxPages };
};

// run_started_at is the honest field - created_at is when the task was queued,
// and a task can sit queued behind the single runner slot this fleet has. They
// are usually equal; when they are not, the later one is when the work happened.
const startedAt = (task) => Date.parse(task.run_started_at || task.created_at || 0) || 0;

export const sweepTasks = (tasks, { job = 'sweep', workflow = 'delete-merged-branch.yml' } = {}) =>
  tasks.filter((t) => t.name === job && t.workflow_id === workflow);

// A skipped task is not a run. The sweep job carries an `if:` that keeps it off
// pull_request events, so every merge files a skipped `sweep` task alongside the
// real `delete` one - and counting those as liveness would make this check pass
// forever on merge traffic alone, which is precisely the hollow reassurance it
// exists to avoid.
export const verdict = (tasks, { windowHours = 48, now = Date.now(), job, workflow } = {}) => {
  const since = now - windowHours * 3600_000;
  const all = sweepTasks(tasks, { job, workflow }).sort((a, b) => startedAt(b) - startedAt(a));
  const succeeded = all.filter((t) => t.status === 'success');
  const failedInWindow = all.filter((t) => t.status === 'failure' && startedAt(t) >= since);
  const last = succeeded[0] ?? null;
  const ageHours = last ? (now - startedAt(last)) / 3600_000 : null;
  return {
    ok: Boolean(last) && ageHours <= windowHours,
    last,
    ageHours,
    windowHours,
    failedInWindow,
    everRan: all.length > 0,
  };
};

const hours = (n) => `${n.toFixed(1)}h`;

export const summaryLines = ({ ok, last, ageHours, windowHours, failedInWindow, everRan }) => {
  const lines = [];
  if (ok) {
    lines.push(`branch sweep last succeeded ${hours(ageHours)} ago, inside the ${windowHours}h window`);
  } else if (last) {
    lines.push(`branch sweep last succeeded ${hours(ageHours)} ago, outside the ${windowHours}h window`);
  } else if (everRan) {
    lines.push(`branch sweep has run but never succeeded, so nothing is sweeping merged branches`);
  } else {
    lines.push(`no branch sweep has ever run`);
  }
  for (const t of failedInWindow) {
    lines.push(`  FAILED  task ${t.id}  ${t.run_started_at || t.created_at}`);
  }
  if (ok) {
    if (failedInWindow.length) {
      lines.push('');
      lines.push('The sweep is alive but not clean. A failing sweep leaves merged branches');
      lines.push('on the remote exactly as a missing one does; read the job log.');
    }
    return lines;
  }
  lines.push('');
  lines.push('The sweep is the backstop for a merge whose delete event never arrived.');
  lines.push('While it is not running, nothing is - and the symptom is branches quietly');
  lines.push('accumulating, which is invisible until someone reads the branch list.');
  lines.push('Check the schedule in .forgejo/workflows/delete-merged-branch.yml and run it');
  lines.push('once by hand (workflow_dispatch) to confirm the job itself still works.');
  return lines;
};
