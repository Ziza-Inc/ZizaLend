#!/usr/bin/env node
/**
 * Publish the contributor backlog to GitHub issues.
 *
 * `docs/contributor-issues/*.md` is the source of truth. Each file carries YAML
 * frontmatter and a body; this script creates the issues that do not exist, updates the
 * ones that have drifted, and reports the rest. Running it twice changes nothing the
 * second time.
 *
 * Why a script rather than opening issues by hand
 * ----------------------------------------------
 * The backlog is meant to be reviewed and amended like code. A publisher makes the
 * backlog diffable: a reviewer sees a proposed issue in a pull request before it
 * appears in the tracker, and a closed-without-reason issue can be re-opened by the
 * next run if the draft is still present. The ten issues published before this script
 * existed arrived with the title `---`, because the ad-hoc command that created them
 * mis-parsed the frontmatter. That failure mode is what idempotent, tested tooling
 * removes.
 *
 * Matching
 * --------
 * Each published body carries `<!-- backlog-id: <slug> -->`. That marker, not the
 * title, is the identity: renaming a draft updates its issue instead of creating a
 * second one.
 *
 * Usage
 * -----
 *   node scripts/publish-issues.mjs --dry-run          # report only (default)
 *   node scripts/publish-issues.mjs --apply            # create and update
 *   node scripts/publish-issues.mjs --apply --close-missing
 *
 * Requires GITHUB_TOKEN with `issues: write`, or GH_TOKEN.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKLOG_DIR = path.join(__dirname, '..', 'docs', 'contributor-issues');
const API = 'https://api.github.com';

/**
 * Resolve the repository to publish to.
 *
 * Order matters. `GITHUB_REPOSITORY` is the obvious source in Actions, but it is also
 * set locally to whatever repository the developer's machine happens to be in — in a
 * GitHub Codespace it names the codespace's repository, not the one being worked on.
 * Trusting it unconditionally means a local run opens a hundred issues in an unrelated
 * project, which I nearly did. The git remote is the repository actually checked out
 * here, so it is the right default; the flag overrides everything for a fork or a
 * mirror.
 */
function resolveRepo() {
    const flag = process.argv.find(argument => argument.startsWith('--repo='));
    if (flag) return flag.slice('--repo='.length);
    try {
        const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
        if (match) return match[1];
    } catch {
        // No git remote: fall through to the environment.
    }
    return process.env.GITHUB_REPOSITORY || 'Ziza-Inc/ZizaLend';
}

const REPO = resolveRepo();

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const closeMissing = args.has('--close-missing');
const validateOnly = args.has('--validate-only');
const checkIndex = args.has('--check-index');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!validateOnly && !token) {
    console.error('GITHUB_TOKEN (or GH_TOKEN) is required. Use --validate-only to check the');
    console.error('backlog without contacting the API.');
    process.exit(2);
}

const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'zizalend-backlog-publisher',
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Delay between writes.
 *
 * GitHub applies a *secondary* rate limit to rapid content creation, distinct from the
 * primary request quota. Creating the whole backlog in one burst trips it partway
 * through — the first full publish reached issue 113 of 116 and then had every
 * subsequent write refused for several minutes. Pacing the writes costs a few seconds
 * and turns a partial publish into a complete one.
 */
const WRITE_PACING_MS = 900;

async function github(method, url, body) {
    const target = url.startsWith('http') ? url : `${API}${url}`;
    const maxAttempts = 6;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await fetch(target, {
            method,
            headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });

        if (response.ok) {
            return response.status === 204 ? null : response.json();
        }

        const text = await response.text();
        const retryable =
            response.status === 429 ||
            (response.status === 403 && /secondary rate limit|rate limit/i.test(text));

        if (!retryable || attempt === maxAttempts) {
            throw new Error(`${method} ${target} → ${response.status} ${text.slice(0, 400)}`);
        }

        // Honour `retry-after` when GitHub sends it; otherwise back off exponentially.
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(60_000, 5_000 * 2 ** (attempt - 1));
        console.log(`  … rate limited, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${maxAttempts})`);
        await sleep(waitMs);
    }

    throw new Error('unreachable');
}

/**
 * Parse the subset of YAML this repository's drafts use: scalar keys and a
 * single-line flow sequence of quoted strings.
 */
function parseFrontmatter(source, file) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
    if (!match) {
        throw new Error(`${file}: missing or malformed frontmatter block`);
    }
    const [, raw, body] = match;
    const fields = {};
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const separator = line.indexOf(':');
        if (separator === -1) throw new Error(`${file}: frontmatter line without a colon: ${line}`);
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (value.startsWith('[')) {
            fields[key] = [...value.matchAll(/"([^"]*)"/g)].map(m => m[1]);
        } else {
            fields[key] = value.replace(/^"(.*)"$/, '$1');
        }
    }
    for (const required of ['title', 'labels']) {
        if (!fields[required]) throw new Error(`${file}: frontmatter is missing "${required}"`);
    }
    if (fields.title === '---') throw new Error(`${file}: title is literally "---"`);
    return { ...fields, body: body.trim() };
}

function backlogId(file) {
    return path.basename(file, '.md').replace(/^\d+-/, '');
}

function renderBody(id, draft) {
    return `${draft.body}\n\n<!-- backlog-id: ${id} -->\n`;
}

async function loadDrafts() {
    const entries = (await fs.readdir(BACKLOG_DIR)).filter(name => /^\d+-.*\.md$/.test(name)).sort();
    if (entries.length === 0) throw new Error(`No drafts found in ${BACKLOG_DIR}`);

    const drafts = [];
    const seenIds = new Set();
    const seenTitles = new Map();
    for (const name of entries) {
        const file = path.join(BACKLOG_DIR, name);
        const parsed = parseFrontmatter(await fs.readFile(file, 'utf8'), name);
        const id = backlogId(name);

        if (seenIds.has(id)) throw new Error(`duplicate backlog id: ${id}`);
        seenIds.add(id);
        if (seenTitles.has(parsed.title)) {
            throw new Error(`duplicate title: "${parsed.title}" in ${name} and ${seenTitles.get(parsed.title)}`);
        }
        seenTitles.set(parsed.title, name);

        drafts.push({ id, file: name, ...parsed, rendered: renderBody(id, parsed) });
    }
    return drafts;
}

async function loadExistingIssues() {
    const issues = [];
    for (let page = 1; ; page++) {
        const batch = await github('GET', `/repos/${REPO}/issues?state=all&per_page=100&page=${page}`);
        issues.push(...batch.filter(issue => !issue.pull_request));
        if (batch.length < 100) break;
    }
    return issues;
}

async function main() {
    const drafts = await loadDrafts();

    if (validateOnly) {
        console.log(`\nBacklog OK — ${drafts.length} drafts validated (frontmatter, unique ids, unique titles).`);

        if (checkIndex) {
            const index = await fs.readFile(path.join(BACKLOG_DIR, 'README.md'), 'utf8');
            const missing = drafts.filter(draft => !index.includes(`./${draft.file}`));
            if (missing.length) {
                console.error(`\n  ${missing.length} draft(s) missing from docs/contributor-issues/README.md:`);
                for (const draft of missing.slice(0, 20)) console.error(`    ${draft.file}`);
                console.error('\n  Regenerate the index so the backlog is navigable.\n');
                process.exit(1);
            }
            console.log('  Index lists every draft.\n');
        }
        return;
    }

    const existing = await loadExistingIssues();

    const byBacklogId = new Map();
    const byTitle = new Map();
    const unmanaged = [];
    for (const issue of existing) {
        const marker = /<!--\s*backlog-id:\s*([\w-]+)\s*-->/.exec(issue.body ?? '');
        if (marker) byBacklogId.set(marker[1], issue);
        byTitle.set(issue.title, issue);
    }

    const toCreate = [];
    const toUpdate = [];
    const matched = new Set();

    for (const draft of drafts) {
        // A draft with no marker may still have been published by an earlier, marker-less
        // run. Matching on the title adopts it rather than opening a duplicate.
        const issue = byBacklogId.get(draft.id) ?? byTitle.get(draft.title);
        if (!issue) {
            toCreate.push(draft);
            continue;
        }
        matched.add(issue.number);

        const labelsChanged =
            JSON.stringify([...issue.labels.map(l => l.name)].sort()) !==
            JSON.stringify([...draft.labels].sort());
        const drifted =
            issue.title !== draft.title || (issue.body ?? '').trim() !== draft.rendered.trim() || labelsChanged;

        if (drifted || issue.state !== 'open') {
            toUpdate.push({ draft, issue, labelsChanged });
        }
    }

    for (const issue of existing) {
        if (!matched.has(issue.number)) unmanaged.push(issue);
    }

    console.log(`\nZizaLend issue backlog → ${REPO}`);
    console.log(`  drafts          : ${drafts.length}`);
    console.log(`  existing issues : ${existing.length}`);
    console.log(`  to create       : ${toCreate.length}`);
    console.log(`  to update       : ${toUpdate.length}`);
    console.log(`  not in backlog  : ${unmanaged.length}`);
    if (!apply) console.log('\nDry run. Pass --apply to write changes.\n');

    for (const draft of toCreate) {
        console.log(`  + ${draft.id}  ${draft.title}`);
    }
    for (const { draft, issue } of toUpdate) {
        console.log(`  ~ #${issue.number} ${draft.id}  ${draft.title}`);
    }

    if (!apply) {
        if (unmanaged.length) {
            console.log('\n  Issues with no matching draft (use --close-missing to close):');
            for (const issue of unmanaged.slice(0, 20)) {
                console.log(`    #${issue.number} [${issue.state}] ${issue.title}`);
            }
        }
        return;
    }

    let written = 0;
    for (const draft of toCreate) {
        const created = await github('POST', `/repos/${REPO}/issues`, {
            title: draft.title,
            body: draft.rendered,
            labels: draft.labels,
        });
        console.log(`  created #${created.number}  ${draft.id}`);
        written++;
        await sleep(WRITE_PACING_MS);
    }
    if (written) console.log(`  (paced ${WRITE_PACING_MS}ms between ${written} creates)`);

    for (const { draft, issue } of toUpdate) {
        // Re-opened deliberately: a draft that is still in the backlog is still work.
        await github('PATCH', `/repos/${REPO}/issues/${issue.number}`, {
            title: draft.title,
            body: draft.rendered,
            labels: draft.labels,
            state: 'open',
        });
        console.log(`  updated #${issue.number}  ${draft.id}`);
    }

    if (closeMissing && unmanaged.length) {
        for (const issue of unmanaged) {
            if (issue.state !== 'open') continue;
            await github('POST', `/repos/${REPO}/issues/${issue.number}/comments`, {
                body: 'Closing: this issue is not in `docs/contributor-issues/`, which is now the source of truth for the backlog. If the work is still wanted, add a draft there and run `node scripts/publish-issues.mjs --apply`, which will re-open this issue rather than duplicating it.',
            });
            await github('PATCH', `/repos/${REPO}/issues/${issue.number}`, { state: 'closed' });
            console.log(`  closed #${issue.number}  ${issue.title}`);
        }
    }

    console.log('\nDone.\n');
}

main().catch(error => {
    console.error(`\nBacklog publish failed: ${error.message}\n`);
    process.exit(1);
});
