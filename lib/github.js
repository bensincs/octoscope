// Server-side GitHub GraphQL client — read-only.
// Token comes from the authenticated session (never the browser).

const ENDPOINT = "https://api.github.com/graphql";

async function gql(token, query, variables, { tolerateErrors = false, retries = 2 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "GraphQL-Features": "issue_types,sub_issues",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    if (res.status === 401) {
      // Flagged so callers can tell "your GitHub sign-in is dead" apart from
      // "this one repository failed". They need very different responses: one
      // is re-authenticate, the other is check the repository.
      const err = new Error(
        "GitHub rejected your sign-in. Sign out and back in to reconnect your account.",
      );
      err.githubAuthFailed = true;
      throw err;
    }

    // 5xx from GitHub is usually transient load, not a bad request — retry with
    // a short backoff before giving up. Expensive queries (merge state) make
    // these common enough that failing on the first one is needlessly brittle.
    if (res.status >= 500 && attempt < retries) {
      lastError = new Error(`GitHub API error: ${res.status}`);
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

    const json = await res.json();
    if (!tolerateErrors && json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json;
  }

  throw lastError ?? new Error("GitHub API error");
}

// ---------------------------------------------------------------------------
// Owners: the signed-in user + their organizations
// ---------------------------------------------------------------------------
export async function getOwners(token) {
  const json = await gql(
    token,
    `query {
      viewer {
        login
        name
        avatarUrl
        organizations(first: 100) {
          nodes { login name avatarUrl }
        }
      }
    }`
  );
  const v = json.data.viewer;
  const viewer = {
    login: v.login,
    name: v.name || v.login,
    avatarUrl: v.avatarUrl,
    type: "user",
  };
  const orgs = (v.organizations.nodes || []).map((o) => ({
    login: o.login,
    name: o.name || o.login,
    avatarUrl: o.avatarUrl,
    type: "org",
  }));
  return { viewer, owners: [viewer, ...orgs] };
}

// ---------------------------------------------------------------------------
// User search (for the collaborator picker)
// ---------------------------------------------------------------------------
export async function searchUsers(token, q, limit = 7) {
  const query = String(q ?? "").trim();
  if (!query) return { users: [] };
  const json = await gql(
    token,
    `query($q: String!, $n: Int!) {
      search(query: $q, type: USER, first: $n) {
        nodes {
          __typename
          ... on User { login name avatarUrl }
        }
      }
    }`,
    { q: query, n: limit }
  );
  const users = (json.data.search.nodes || [])
    .filter((n) => n.__typename === "User")
    .map((n) => ({ login: n.login, name: n.name || n.login, avatarUrl: n.avatarUrl }));
  return { users };
}

// ---------------------------------------------------------------------------
// Repositories for any owner (user or org)
// ---------------------------------------------------------------------------
export async function getRepos(token, login) {
  const repos = [];
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const json = await gql(
      token,
      `query($login: String!, $cursor: String) {
        repositoryOwner(login: $login) {
          repositories(first: 100, after: $cursor, orderBy: { field: PUSHED_AT, direction: DESC }) {
            pageInfo { hasNextPage endCursor }
            nodes {
              name
              nameWithOwner
              url
              isPrivate
              isArchived
              issues(states: OPEN) { totalCount }
            }
          }
        }
      }`,
      { login, cursor }
    );
    const conn = json.data.repositoryOwner?.repositories;
    if (!conn) break;
    for (const r of conn.nodes) {
      repos.push({
        name: r.name,
        nameWithOwner: r.nameWithOwner,
        url: r.url,
        isPrivate: r.isPrivate,
        isArchived: r.isArchived,
        openIssues: r.issues.totalCount,
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return repos;
}

// ---------------------------------------------------------------------------
// Projects v2 for any owner (user or org)
// ---------------------------------------------------------------------------
export async function getProjects(token, login) {
  const json = await gql(
    token,
    `query($login: String!) {
      repositoryOwner(login: $login) {
        __typename
        ... on ProjectV2Owner {
          projectsV2(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes { number title url closed }
          }
        }
      }
    }`,
    { login },
    { tolerateErrors: true }
  );
  const owner = json.data?.repositoryOwner;
  const nodes = owner?.projectsV2?.nodes || [];
  return {
    projects: nodes
      .filter((p) => !p.closed)
      .map((p) => ({ number: p.number, title: p.title, url: p.url })),
  };
}

// ---------------------------------------------------------------------------
// Issues for a repo (with issue types + parent/sub-issue links)
// ---------------------------------------------------------------------------
const ISSUES_QUERY = `
query Issues($owner: String!, $name: String!, $cursor: String, $states: [IssueState!]) {
  rateLimit { limit cost remaining resetAt }
  repository(owner: $owner, name: $name) {
    name
    nameWithOwner
    issues(first: 100, after: $cursor, states: $states, orderBy: { field: CREATED_AT, direction: ASC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        id number title url state
        issueType { name color }
        parent { id number title issueType { name } }
        subIssues(first: 1) { totalCount }
        assignees(first: 5) { nodes { login avatarUrl } }
        labels(first: 50) { nodes { name } }
      }
    }
  }
}`;

export async function getRepoIssues(token, owner, name, includeClosed) {
  const states = includeClosed ? ["OPEN", "CLOSED"] : ["OPEN"];
  let cursor = null;
  let repoMeta = null;
  const issues = [];

  for (let page = 0; page < 50; page++) {
    const json = await gql(token, ISSUES_QUERY, { owner, name, cursor, states });
    const repo = json.data.repository;
    if (!repo) throw new Error("Repository not found or not accessible.");
    repoMeta = { name: repo.name, nameWithOwner: repo.nameWithOwner };
    const conn = repo.issues;
    for (const n of conn.nodes) issues.push(mapIssueNode(n));
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return { repo: repoMeta, issues };
}

function mapIssueNode(n) {
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    state: n.state,
    type: n.issueType?.name || null,
    parentId: n.parent?.id || null,
    parentNumber: n.parent?.number || null,
    parentType: n.parent?.issueType?.name || null,
    subIssueCount: n.subIssues?.totalCount || 0,
    assignees: (n.assignees?.nodes || []).map((a) => ({
      login: a.login,
      avatarUrl: a.avatarUrl,
    })),
    labels: (n.labels?.nodes || []).map((l) => l.name).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Project field values (Status + Sprint/iteration) keyed by issue node id
// ---------------------------------------------------------------------------
const PROJECT_FRAGMENT = `
  title url
  items(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      content { __typename ... on Issue { id } ... on PullRequest { id } }
      fieldValues(first: 30) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldSingleSelectValue {
            name field { ... on ProjectV2FieldCommon { name } }
          }
          ... on ProjectV2ItemFieldIterationValue {
            title startDate duration field { ... on ProjectV2FieldCommon { name } }
          }
        }
      }
    }
  }`;

export function sprintState(startDate, duration) {
  if (!startDate) return "unknown";
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (duration || 0));
  const now = new Date();
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  if (today >= end) return "past";
  if (today < start) return "future";
  return "current";
}

export function extractFields(item) {
  let status = null;
  let sprint = null;
  for (const fv of item.fieldValues?.nodes || []) {
    const fieldName = (fv.field?.name || "").toLowerCase();
    if (fv.__typename === "ProjectV2ItemFieldSingleSelectValue") {
      if (fieldName === "status" || !status) status = fv.name;
    } else if (fv.__typename === "ProjectV2ItemFieldIterationValue") {
      sprint = {
        name: fv.title,
        state: sprintState(fv.startDate, fv.duration),
      };
    }
  }
  return { status, sprint };
}

// A Projects v2 board is owned by a user OR an organization. GitHub logins are
// globally unique across both namespaces, so we simply try both roots — no
// stored "owner type" is needed to disambiguate.
const PROJECT_ROOTS = ["organization", "user"];

// Distinguish a benign "wrong root" miss (GitHub NOT_FOUND when we query the
// other kind of owner) from a real access failure (SSO not authorized, missing
// scope, …) so we can surface an accurate message instead of "not found".
function accessErrorMessages(errors) {
  return (errors || [])
    .filter((e) => e.type !== "NOT_FOUND")
    .map((e) => e.message);
}

export async function getProjectFields(token, login, number) {
  const accessErrors = [];
  for (const root of PROJECT_ROOTS) {
    const result = await runProject(token, root, login, number);
    if (result.ownerResolved) return result;
    accessErrors.push(...accessErrorMessages(result.errors));
  }
  if (accessErrors.length) {
    throw new Error(
      `Couldn't access project #${number} for "${login}": ${[
        ...new Set(accessErrors),
      ].join("; ")}`
    );
  }
  throw new Error(`Couldn't find a user or organization named "${login}".`);
}

async function runProject(token, root, login, number) {
  const query = `query Project($login: String!, $number: Int!, $cursor: String) {
    ${root}(login: $login) { projectV2(number: $number) { ${PROJECT_FRAGMENT} } }
  }`;
  let cursor = null;
  let meta = null;
  const byId = new Map();

  for (let page = 0; page < 50; page++) {
    const json = await gql(token, query, { login, number, cursor }, { tolerateErrors: true });
    const owner = json.data?.[root];
    if (owner == null) return { ownerResolved: false, errors: json.errors || [] };
    const project = owner.projectV2;
    if (!project) {
      throw new Error(
        `Found "${login}", but couldn't read project #${number}. ` +
          `Your token needs project read access, and for org projects it must be SSO-authorized.`
      );
    }
    meta = { title: project.title, url: project.url };
    for (const item of project.items.nodes) {
      const id = item.content?.id;
      if (!id) continue;
      byId.set(id, extractFields(item));
    }
    if (!project.items.pageInfo.hasNextPage) break;
    cursor = project.items.pageInfo.endCursor;
  }
  return { ownerResolved: true, project: meta, fields: byId };
}

// ---------------------------------------------------------------------------
// Full audit: issues merged with project Status/Sprint + membership flags
// ---------------------------------------------------------------------------
export async function runAudit(token, opts) {
  const { repoOwner, repoName, includeClosed, project } = opts;
  const { repo, issues } = await getRepoIssues(token, repoOwner, repoName, includeClosed);

  let projectMeta = null;
  if (project) {
    const proj = await getProjectFields(
      token,
      project.login,
      project.number
    );
    projectMeta = proj.project;
    for (const issue of issues) {
      issue.projectActive = true;
      const f = proj.fields.get(issue.id);
      issue.inProject = !!f;
      if (f) {
        issue.status = f.status;
        issue.sprint = f.sprint;
      }
    }
  }

  return { repo, issues, project: projectMeta, projectActive: !!project };
}

// ---------------------------------------------------------------------------
// Saved-project audit: aggregate many repos (each with its own PAT) and many
// Projects v2 boards (each with its own PAT) into a single issue set.
//
// Input:
//   repos  = [{ owner, name, token }]
//   boards = [{ login, number, token }]
//   includeClosed = boolean
//
// Fetches everything CONCURRENTLY and is fault-tolerant: a single repo or board
// that fails is reported as a warning instead of aborting the whole audit.
// Project field values from every board are merged by issue node id, so an
// issue that lives on any connected board picks up its Status/Sprint.
// `projectActive` is true when at least one board is configured, which is what
// enables the project-membership and status rules downstream.
// ---------------------------------------------------------------------------
export async function runSavedAudit({ repos = [], boards = [], includeClosed = false } = {}) {
  const warnings = [];

  const repoPromises = repos.map(async (r) => {
    try {
      const { repo, issues } = await getRepoIssues(r.token, r.owner, r.name, includeClosed);
      return { ok: true, repo, issues, input: r };
    } catch (e) {
      return { ok: false, error: e.message, authFailed: !!e.githubAuthFailed, input: r };
    }
  });

  const boardPromises = boards.map(async (b) => {
    try {
      const proj = await getProjectFields(b.token, b.login, b.number);
      return { ok: true, project: proj.project, fields: proj.fields, input: b };
    } catch (e) {
      return { ok: false, error: e.message, authFailed: !!e.githubAuthFailed, input: b };
    }
  });

  const [repoSettled, boardSettled] = await Promise.all([
    Promise.all(repoPromises),
    Promise.all(boardPromises),
  ]);

  // A rejected sign-in affects everything, so report it as such instead of
  // emitting one warning per repository and leaving the user to infer it.
  const authFailure = [...repoSettled, ...boardSettled].find((r) => r.authFailed);
  if (authFailure) {
    const err = new Error(authFailure.error);
    err.githubAuthFailed = true;
    throw err;
  }

  // Merge every board's field values into one lookup keyed by issue node id.
  const fieldsById = new Map();
  const boardMetas = [];
  for (const b of boardSettled) {
    if (!b.ok) {
      warnings.push({
        scope: "board",
        message: `Project #${b.input.number} (${b.input.login}): ${b.error}`,
      });
      continue;
    }
    boardMetas.push({
      title: b.project?.title || `Project #${b.input.number}`,
      url: b.project?.url || null,
      login: b.input.login,
      number: b.input.number,
    });
    for (const [id, f] of b.fields) {
      if (!fieldsById.has(id)) fieldsById.set(id, f);
    }
  }

  const projectActive = boards.length > 0;
  const issues = [];
  const repoMetas = [];

  for (const r of repoSettled) {
    if (!r.ok) {
      warnings.push({
        scope: "repo",
        message: `${r.input.owner}/${r.input.name}: ${r.error}`,
      });
      continue;
    }
    for (const issue of r.issues) {
      if (projectActive) {
        issue.projectActive = true;
        const f = fieldsById.get(issue.id);
        issue.inProject = !!f;
        if (f) {
          issue.status = f.status;
          issue.sprint = f.sprint;
        }
      }
      issue.repo = r.repo.nameWithOwner;
      issues.push(issue);
    }
    repoMetas.push({ ...r.repo, issueCount: r.issues.length });
  }

  return { issues, repos: repoMetas, boards: boardMetas, projectActive, warnings };
}

// ---------------------------------------------------------------------------
// Streaming audit: yields events as data arrives so the UI can render live.
// Issues and project fields are fetched CONCURRENTLY and interleaved.
// Events:
//   { type: "repo", repo, total }
//   { type: "issues", issues: [...] }            (one per issue page)
//   { type: "project", project }
//   { type: "fields", fields: { id: {...} } }     (one per project page)
//   { type: "rateLimit", rateLimit }              (latest GitHub budget)
//   { type: "warning", scope, message, fatal? }   (non-fatal problems)
//   { type: "done" }
// A thrown error (e.g. repo not found) is fatal and surfaced as "error".
// ---------------------------------------------------------------------------

const PAGE_CAP = 50; // 100 items per page → up to 5,000 items
const MAX_ITEMS = PAGE_CAP * 100;

function readRateLimit(json) {
  const rl = json.data?.rateLimit;
  if (!rl) return null;
  return {
    remaining: rl.remaining,
    limit: rl.limit,
    cost: rl.cost,
    resetAt: rl.resetAt,
  };
}

export async function* streamAudit(token, opts) {
  const { repoOwner, repoName, includeClosed, project } = opts;
  const streams = [issueStream(token, repoOwner, repoName, includeClosed)];
  if (project) streams.push(projectStream(token, project));
  yield* mergeStreams(streams);
  yield { type: "done" };
}

// Issue pages for the repo. Throws on a fatal (repo missing/inaccessible).
async function* issueStream(token, owner, name, includeClosed) {
  const states = includeClosed ? ["OPEN", "CLOSED"] : ["OPEN"];
  let cursor = null;
  let sentRepo = false;
  let page = 0;

  for (; page < PAGE_CAP; page++) {
    const json = await gql(token, ISSUES_QUERY, { owner, name, cursor, states });
    const rl = readRateLimit(json);
    if (rl) yield { type: "rateLimit", rateLimit: rl };

    const repo = json.data.repository;
    if (!repo) throw new Error("Repository not found or not accessible.");
    const conn = repo.issues;
    if (!sentRepo) {
      sentRepo = true;
      yield {
        type: "repo",
        repo: { name: repo.name, nameWithOwner: repo.nameWithOwner },
        total: conn.totalCount,
      };
    }
    yield { type: "issues", issues: conn.nodes.map(mapIssueNode) };
    if (!conn.pageInfo.hasNextPage) return;
    cursor = conn.pageInfo.endCursor;
  }
  // Exhausted the page cap with more still available.
  yield {
    type: "warning",
    scope: "issues",
    message: `Showing the first ${MAX_ITEMS.toLocaleString()} issues — some were not audited.`,
  };
}

// Project field pages. Never throws: any failure is yielded as a fatal warning
// so the issue audit still completes.
async function* projectStream(token, project) {
  const { login, number } = project;
  const accessErrors = [];

  try {
    for (const root of PROJECT_ROOTS) {
      const query = `query Project($login: String!, $number: Int!, $cursor: String) {
        rateLimit { limit cost remaining resetAt }
        ${root}(login: $login) { projectV2(number: $number) { ${PROJECT_FRAGMENT} } }
      }`;
      let cursor = null;
      let resolved = false;
      let sentMeta = false;
      let page = 0;

      for (; page < PAGE_CAP; page++) {
        const json = await gql(
          token,
          query,
          { login, number, cursor },
          { tolerateErrors: true }
        );
        const rl = readRateLimit(json);
        if (rl) yield { type: "rateLimit", rateLimit: rl };

        const owner = json.data?.[root];
        if (owner == null) {
          accessErrors.push(...accessErrorMessages(json.errors));
          break; // wrong root or no access — try the next one
        }
        resolved = true;
        const proj = owner.projectV2;
        if (!proj) {
          throw new Error(
            `Found "${login}", but couldn't read project #${number}. ` +
              `Your token needs project read access, and for org projects it must be SSO-authorized.`
          );
        }
        if (!sentMeta) {
          sentMeta = true;
          yield { type: "project", project: { title: proj.title, url: proj.url } };
        }
        const fields = {};
        for (const item of proj.items.nodes) {
          const id = item.content?.id;
          if (id) fields[id] = extractFields(item);
        }
        yield { type: "fields", fields };
        if (!proj.items.pageInfo.hasNextPage) return;
        cursor = proj.items.pageInfo.endCursor;
      }
      if (resolved) {
        // Hit the page cap: project membership is incomplete.
        yield {
          type: "warning",
          scope: "project",
          partial: true,
          message: `Only the first ${MAX_ITEMS.toLocaleString()} project items were read — board-membership checks may be incomplete.`,
        };
        return;
      }
    }
    yield {
      type: "warning",
      scope: "project",
      fatal: true,
      message: accessErrors.length
        ? `Couldn't access project #${number} for "${login}": ${[
            ...new Set(accessErrors),
          ].join("; ")}`
        : `Couldn't find a user or organization named "${login}".`,
    };
  } catch (e) {
    yield { type: "warning", scope: "project", fatal: true, message: e.message };
  }
}

// Concurrently consume several async iterables, yielding values as they arrive.
async function* mergeStreams(streams) {
  const iters = streams.map((s) => s[Symbol.asyncIterator]());
  const pending = new Map();
  const arm = (i) =>
    pending.set(
      i,
      iters[i].next().then((res) => ({ i, res }))
    );
  iters.forEach((_, i) => arm(i));

  try {
    while (pending.size) {
      const { i, res } = await Promise.race(pending.values());
      if (res.done) {
        pending.delete(i);
      } else {
        yield res.value;
        arm(i);
      }
    }
  } finally {
    // Best-effort: close any iterators still open (e.g. after a fatal throw).
    for (const i of pending.keys()) {
      try {
        iters[i].return?.();
      } catch {}
    }
  }
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

/**
 * Every OPEN pull request in a repository, including drafts.
 *
 * Paginated: a busy repo can have hundreds open, and silently returning only
 * the first page would understate somebody's review load — the whole point of
 * the by-author view. Capped so a pathological repo can't spin forever.
 */
// Merge state is computed on demand by GitHub, so it is FAR more expensive than
// the rest of a pull request. Measured against a busy repo: 100 PRs with merge
// state 502s after ~11s, while the same 100 without it return in ~1.2s and 25
// with it take ~10s. So the two are fetched separately.
const PR_PAGE_SIZE = 100;
const HEALTH_BATCH_SIZE = 20;
const HEALTH_BUDGET_MS = 30_000;

/**
 * Every OPEN pull request in a repository, including drafts.
 *
 * Two passes, deliberately:
 *   1. the list itself — cheap, paginated, must always succeed
 *   2. merge/check state — expensive, batched, BEST EFFORT
 *
 * A failure or timeout in pass 2 leaves those fields null, which the rulebook
 * reports as "merge state unknown" rather than as healthy. Losing the whole
 * pull-request list because GitHub was slow to compute a trial merge would be a
 * far worse outcome than showing a few unknowns.
 */
export async function getOpenPullRequests(token, owner, name, { maxPages = 10 } = {}) {
  const out = [];
  let cursor = null;

  for (let page = 0; page < maxPages; page++) {
    const json = await gql(
      token,
      `query($owner:String!, $name:String!, $cursor:String) {
        repository(owner:$owner, name:$name) {
          pullRequests(states: OPEN, first: ${PR_PAGE_SIZE}, after: $cursor,
                       orderBy: { field: UPDATED_AT, direction: DESC }) {
            pageInfo { hasNextPage endCursor }
            nodes {
              number
              title
              url
              isDraft
              createdAt
              updatedAt
              author { login avatarUrl }
            }
          }
        }
      }`,
      { owner, name, cursor }
    );

    const conn = json.data?.repository?.pullRequests;
    if (!conn) break;

    for (const n of conn.nodes || []) {
      out.push({
        number: n.number,
        title: n.title,
        url: n.url,
        isDraft: !!n.isDraft,
        // author is null for PRs from deleted accounts.
        authorLogin: n.author?.login ?? null,
        authorAvatarUrl: n.author?.avatarUrl ?? null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        // Filled in by the health pass; null means "not known", not "fine".
        mergeable: null,
        mergeStateStatus: null,
        checksState: null,
      });
    }

    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  await attachHealth(token, owner, name, out);
  return out;
}

/**
 * Fill in merge/check state in batches, within a time budget.
 *
 * Most-recently-updated pull requests are covered first (the list is already in
 * that order), so if the budget runs out it's the stalest ones left unknown.
 */
async function attachHealth(token, owner, name, prs) {
  const deadline = Date.now() + HEALTH_BUDGET_MS;

  for (let i = 0; i < prs.length; i += HEALTH_BATCH_SIZE) {
    if (Date.now() > deadline) break;

    const batch = prs.slice(i, i + HEALTH_BATCH_SIZE);
    const aliases = batch
      .map(
        (pr) =>
          `p${pr.number}: pullRequest(number: ${pr.number}) {
             mergeable
             mergeStateStatus
             commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
           }`
      )
      .join("\n          ");

    try {
      const json = await gql(
        token,
        `query($owner:String!, $name:String!) {
          repository(owner:$owner, name:$name) {
            ${aliases}
          }
        }`,
        { owner, name },
        // Partial data is fine here: whatever resolves gets used.
        { tolerateErrors: true }
      );

      const repo = json.data?.repository ?? {};
      for (const pr of batch) {
        const node = repo[`p${pr.number}`];
        if (!node) continue;
        pr.mergeable = node.mergeable ?? null;
        pr.mergeStateStatus = node.mergeStateStatus ?? null;
        pr.checksState =
          node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
      }
    } catch (e) {
      // Leave this batch unknown and carry on — the list still stands.
      console.error(
        `[github] merge state unavailable for ${owner}/${name} batch ${i}:`,
        e.message
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Architecture Decision Records
// ---------------------------------------------------------------------------

/**
 * Read every markdown file in a repository folder, with its last-commit date.
 *
 * Two requests total, regardless of how many records there are:
 *   1. the tree, which returns each entry's contents inline
 *   2. one query with an ALIASED history(first:1, path:…) per file
 *
 * The alternative — a commit query per file — would be dozens of round trips
 * against a rate-limited API for a folder anyone might refresh.
 */
export async function getRepoFolderMarkdown(token, owner, name, folder, { max = 200 } = {}) {
  const path = String(folder ?? "").replace(/^\/+|\/+$/g, "");

  const treeJson = await gql(
    token,
    `query($owner:String!, $name:String!, $expr:String!) {
      repository(owner:$owner, name:$name) {
        defaultBranchRef { name }
        object(expression:$expr) {
          ... on Tree {
            entries {
              name
              type
              path
              object { ... on Blob { byteSize isBinary text } }
            }
          }
        }
      }
    }`,
    { owner, name, expr: `HEAD:${path}` }
  );

  const repo = treeJson.data?.repository;
  const branch = repo?.defaultBranchRef?.name ?? "HEAD";
  const tree = repo?.object;

  // A missing folder returns null rather than erroring — the caller decides
  // whether that's a misconfiguration or simply an empty project.
  if (!tree || !Array.isArray(tree.entries)) {
    return { branch, found: false, files: [] };
  }

  const files = tree.entries
    .filter(
      (e) =>
        e.type === "blob" &&
        /\.mdx?$/i.test(e.name) &&
        e.object &&
        !e.object.isBinary
    )
    .slice(0, max)
    .map((e) => ({
      name: e.name,
      path: e.path,
      // `text` is null for blobs GitHub declines to inline (very large files).
      body: e.object.text ?? null,
      byteSize: e.object.byteSize ?? null,
    }));

  if (files.length === 0) return { branch, found: true, files: [] };

  // Batch the per-file last-commit lookups into a single aliased query.
  const aliases = files
    .map(
      (f, i) =>
        `f${i}: history(first: 1, path: ${JSON.stringify(f.path)}) { nodes { committedDate } }`
    )
    .join("\n            ");

  let dates = {};
  try {
    const histJson = await gql(
      token,
      `query($owner:String!, $name:String!) {
        repository(owner:$owner, name:$name) {
          defaultBranchRef {
            target {
              ... on Commit {
                ${aliases}
              }
            }
          }
        }
      }`,
      { owner, name },
      // Partial failures here shouldn't lose the documents themselves.
      { tolerateErrors: true }
    );
    dates = histJson.data?.repository?.defaultBranchRef?.target ?? {};
  } catch {
    dates = {};
  }

  return {
    branch,
    found: true,
    files: files.map((f, i) => ({
      ...f,
      lastModifiedAt: dates[`f${i}`]?.nodes?.[0]?.committedDate ?? null,
      url: `https://github.com/${owner}/${name}/blob/${branch}/${f.path}`,
    })),
  };
}
