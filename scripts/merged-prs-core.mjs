// The parts of the merge audit that touch neither the network nor git, kept
// separate so test/merged-prs.test.mjs can cover them. Same split as
// link-check-core.mjs: the classification and the paging are where the bugs
// are, and they are the half that can be tested without a forge to ask.
//
// The question this answers: the forge says it merged a pull request, but is
// the merge commit actually on the branch? On lokalverket-no, twice on
// 2026-09-14, it was not - merged=true with a correct merge_commit_sha, the
// linked issue auto-closed, the head branch deleted by the cleanup job, and CI
// green on a commit that was on no branch.
//
// Reachability is decided by git, never by the API: the forge's own record of
// refs is the thing under suspicion, and its /branches listing has been seen
// omitting refs that `git ls-remote` reports (nixfleet #172). Asking it whether
// a merge landed would be asking the suspect for an alibi. So this module never
// sees a sha - it takes a resolver the runner backs with git.

// One page at a time, newest-updated first, stopping as soon as no later page
// can hold anything in the window. Merging updates a pull request, so
// merged_at <= updated_at: once a page's oldest updated_at predates the window,
// everything after it does too.
//
// The source this was ported from read a single ?limit=50 page. That is correct
// until the 51st closed pull request and then silently stops being correct,
// which is the exact shape of fault this whole check exists to catch.
export const collectClosed = async (getPage, { limit = 50, maxPages = 10, since = 0 } = {}) => {
  const pulls = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await getPage(page);
    pulls.push(...batch);
    if (batch.length < limit) return { pulls, complete: true, pages: page };
    const oldest = batch[batch.length - 1];
    if (Date.parse(oldest.updated_at) < since) return { pulls, complete: true, pages: page };
  }
  return { pulls, complete: false, pages: maxPages };
};

export const mergedWithin = (pulls, days, now = Date.now()) => {
  const since = now - days * 86400_000;
  return pulls.filter((p) => p.merged && p.merge_commit_sha && Date.parse(p.merged_at) >= since);
};

// resolve(sha) -> 'reachable' | 'unreachable' | 'missing'
//
// The three outcomes are different faults and a report that flattens them is
// not actionable: 'unreachable' means the commit exists and is on no branch,
// which is the rollback case and is recoverable with cherry-pick; 'missing'
// means the forge reports a merge commit it will not serve, which is a
// different and worse thing.
export const classify = (pulls, resolve) => {
  const orphans = [];
  const missing = [];
  for (const p of pulls) {
    const state = resolve(p.merge_commit_sha);
    if (state === 'unreachable') orphans.push(p);
    else if (state === 'missing') missing.push(p);
  }
  return { checked: pulls.length, orphans, missing, ok: !orphans.length && !missing.length };
};

export const summaryLines = ({ checked, orphans, missing, ok }, { ref, days, parentsOf = () => '(unknown)' }) => {
  const lines = [`checked ${checked} merged pull request${checked === 1 ? '' : 's'} from the last ${days} days against ${ref}`];
  for (const p of missing) {
    lines.push(`  UNFETCHABLE  #${p.number}  ${p.merge_commit_sha.slice(0, 7)}  ${p.title}`);
    lines.push('      the forge reports this merge commit but will not serve the object');
  }
  for (const p of orphans) {
    lines.push(`  ORPHANED     #${p.number}  ${p.merge_commit_sha.slice(0, 7)}  ${p.title}`);
    lines.push(`      merged ${p.merged_at}, parents ${parentsOf(p.merge_commit_sha)}, not reachable from ${ref}`);
  }
  if (ok) {
    lines.push('  all reachable');
    return lines;
  }
  lines.push('');
  lines.push('A merge the forge recorded is not on the branch. The work is not lost -');
  lines.push(`re-land it with \`git cherry-pick -x\` of the head commits onto current`);
  lines.push(`${ref} - but nothing else will tell you, so do not close this quietly.`);
  lines.push('Context and the running investigation: nixfleet #172.');
  return lines;
};
