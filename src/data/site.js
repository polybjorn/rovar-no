// Where the content files live, so the "suggest a correction" link on
// machine-translated pages can open the right file in GitHub's web editor.
// A reader with a GitHub account gets a text box and a pull request; no CMS,
// no accounts to hand out, no write access to the site.
export const repo = { owner: 'polybjorn', name: 'rovar-no', branch: 'main' };

export const editUrl = (path) =>
  `https://github.com/${repo.owner}/${repo.name}/edit/${repo.branch}/${path}`;

// Same idea one level up: a folder to browse and edit from, for the README's
// per-language contribute links.
export const treeUrl = (path) =>
  `https://github.com/${repo.owner}/${repo.name}/tree/${repo.branch}/${path}`;
