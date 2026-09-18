// Whether to post a report as a comment, kept pure so test/issue-report.test.mjs
// can cover it. Same split as inert-core.mjs and delete-retries-core.mjs: the
// policy is where the bug was, and it is the half that can be tested without a
// forge to ask.
//
// One caller today (check-inert-prs.mjs). check-delete-retries.mjs posts an
// event rather than a per-pull-request verdict and does not deduplicate, so it
// shares the ISSUE_TOKEN convention below and not this function - see the note
// at its own POST for why that is the cheaper wrong answer there.
//
// THIS EXISTS BECAUSE THE DEGRADATION WAS ONLY HALF BUILT. #51 wrote a POST
// that failed soft and put the read in front of it through a helper that exits
// 2 on any non-2xx, so `merge-audit` went red on the first run that met a real
// inert pull request (#54, run 1978: `GET /issues/53/comments: 403 Forbidden`,
// `Job 'audit' failed`). A reporting step that has already printed its finding
// must never fail the job it reports from - a watchdog taken out by a token
// scope is worse than no watchdog, because the red tick is now about the tick.
//
// THE CREDENTIAL IS PER SURFACE, NOT PER JOB. Measured on this forge:
//
//   FORGE_PR_TOKEN   user scope   reads pulls          403 on /issues/*
//   github.token     actions      reads issues         404 on this repo's pulls
//
// They are complements rather than a preference order, so a step that reads
// pulls AND comments needs both, and "use the stronger one" is exactly how the
// commenting half breaks. See #54 and the FORGE_PR_TOKEN note in the fleet
// rules.
//
// `existing === null` MEANS THE READ FAILED, and is deliberately not the same
// as `[]`. Posting when the already-reported scan could not run would comment
// every morning on the same pull request, which is the one outcome #51 built
// the marker to prevent - a bot that repeats itself gets filtered out along
// with the thing it was trying to say. So a failed read suppresses the post
// rather than forcing it.
export const reportPlan = ({ token, existing, mark }) => {
  if (!token) {
    return { post: false, why: 'no issue token, so nothing was posted - the verdict is above' };
  }
  if (existing === null) {
    return { post: false, why: 'could not read the existing comments, so nothing was posted rather than risk repeating one' };
  }
  if (!mark) {
    return { post: false, why: 'no marker to check against, so nothing was posted rather than risk repeating one' };
  }
  if (existing.some((c) => (c?.body ?? '').includes(mark))) {
    return { post: false, why: 'already reported' };
  }
  return { post: true, why: 'not reported yet' };
};
