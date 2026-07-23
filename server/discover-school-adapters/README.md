# School-specific Discover adapters

This directory contains verified, university-owned crawl seeds for faculty directories,
department/program indexes, research groups/labs, and doctoral-program pages. Adapters
must stay on their declared HTTPS hosts and are rechecked by the adapter health runner.

Each batch exports an array of entries with this shape:

```js
{
  school: 'Exact registry name',
  region: 'US',
  allowedHosts: ['example.edu', 'www.example.edu'],
  seeds: [
    { kind: 'departments', url: 'https://example.edu/academics/departments/' },
    { kind: 'faculty', url: 'https://example.edu/faculty/' },
    { kind: 'research', url: 'https://example.edu/research/labs/' },
    { kind: 'doctoral', url: 'https://example.edu/graduate/phd/' },
  ],
  pathHints: {
    faculty: ['faculty', 'people', 'profile'],
    lab: ['lab', 'group', 'centre'],
    department: ['department', 'school', 'discipline'],
    program: ['phd', 'doctoral', 'graduate'],
  },
  verifiedAt: 'YYYY-MM-DD',
}
```

All four distinct seed kinds are required for every covered school: `faculty`,
`departments`, `research`, and `doctoral`. This is a school-adapter coverage promise,
not a claim about how many search results one run returns. A homepage-only registry row
never counts. A seed is not accepted merely because its host is official: the live
health check must receive HTML and classify the page as its declared kind. Redirect
targets must also remain inside `allowedHosts`.
