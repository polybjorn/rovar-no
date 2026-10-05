// Where the content files live, so the README's per-language contribute links
// can open the right folder in GitHub's web editor. A reader with a GitHub
// account gets a text box and a pull request; no CMS, no accounts to hand out,
// no write access to the site.
export const repo = { owner: 'polybjorn', name: 'rovar-no', branch: 'main' };

// The repository itself, for the footer. The site is built in the open, so
// anyone can see how a page is put together, check where a departure time
// comes from, or correct a mistake without asking us first.
export const repoUrl = `https://github.com/${repo.owner}/${repo.name}`;

export const treeUrl = (path) =>
  `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}/${path}`;
