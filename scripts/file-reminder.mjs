// Files one reminder issue for a weekly check that found something to do
// (season:check, hours:check). The failing job is a push that the next green
// run on the repo clears, so the reminder that lasts is an issue. One open at
// a time per check, found by its marker, so a weekly run against the same
// finding does not file a second. Needs API and ISSUE_TOKEN (the Actions
// token; FORGE_PR_TOKEN is 403 on /issues, #54). Not fatal: the job has
// already failed with the finding printed.
export async function fileReminder({ marker, title, body }) {
  const api = process.env.API;
  const token = process.env.ISSUE_TOKEN;
  if (!api || !token) return;
  const MARK = `<!-- ${marker} -->`;
  const headers = { Authorization: `token ${token}`, 'Content-Type': 'application/json' };
  try {
    const open = await fetch(`${api}/issues?state=open&type=issues&limit=50`, { headers });
    if (!open.ok) throw new Error(`GET /issues: ${open.status}`);
    const existing = (await open.json()).find((i) => i.body?.includes(MARK));
    if (existing) {
      console.error(`already open as #${existing.number}`);
      return;
    }
    const res = await fetch(`${api}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title, body: `${body}\n${MARK}` }),
    });
    if (!res.ok) throw new Error(`POST /issues: ${res.status}`);
    console.error(`filed #${(await res.json()).number}`);
  } catch (err) {
    console.error(`could not file the reminder issue (${err.message}); the finding is above`);
  }
}
