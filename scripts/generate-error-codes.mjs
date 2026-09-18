#!/usr/bin/env node
/**
 * Generate `docs/ERROR_CODES.md` from the sources, and check that it is current.
 *
 * Why generated rather than written
 * ---------------------------------
 * Error codes are the contract's public failure surface: a caller decodes
 * `Error(Contract, #13)` and has to know that 13 means `RepaymentExceedsDebt` and not
 * something else. A hand-written table drifts the first time a variant is added, and a
 * drifted table is worse than none because it is trusted. So the numeric codes, the
 * variants that carry them, and — importantly — *where each one is raised* are all read
 * out of the source here.
 *
 * The `Raised in` and `Guard` columns are extracted from the code rather than described
 * from memory. That is deliberate: a definition of an error that disagrees with the
 * condition that produces it is exactly the documentation failure this file exists to
 * prevent.
 *
 * Usage
 * -----
 *   node scripts/generate-error-codes.mjs            # write docs/ERROR_CODES.md
 *   node scripts/generate-error-codes.mjs --check     # fail if it is out of date
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'ERROR_CODES.md');

/** The contracts that declare a `#[contracterror]` enum, in registry order. */
const CONTRACTS = [
    { name: 'RemittanceNFT', dir: 'remittance_nft', prefix: 'C' },
    { name: 'LoanManager', dir: 'loan_manager', prefix: 'C' },
    { name: 'LendingPool', dir: 'lending_pool', prefix: 'C' },
    { name: 'MultisigGovernance', dir: 'multisig_governance', prefix: 'C' },
];

const check = process.argv.includes('--check');

/** Parse a `#[contracterror]` enum: variant names and their explicit discriminants. */
function parseErrorEnum(source, file) {
    const enumMatch = /pub enum (\w*Error)\s*\{([\s\S]*?)\n\}/.exec(source);
    if (!enumMatch) throw new Error(`${file}: no pub enum *Error found`);

    const [, enumName, body] = enumMatch;
    const variants = [];
    for (const match of body.matchAll(/^\s{4}(\w+)\s*=\s*(\d+)\s*,/gm)) {
        variants.push({ name: match[1], code: Number(match[2]) });
    }
    if (variants.length === 0) throw new Error(`${file}: enum ${enumName} has no variants`);

    const codes = new Set();
    const duplicateCodes = [];
    const names = new Set();
    const duplicateNames = [];
    for (const variant of variants) {
        if (codes.has(variant.code)) duplicateCodes.push(variant.code);
        codes.add(variant.code);
        if (names.has(variant.name)) duplicateNames.push(variant.name);
        names.add(variant.name);
    }

    return { enumName, variants, duplicateCodes, duplicateNames, source };
}

/** A commented-out code, e.g. `// 8 is reserved because ...`. */
function reservedCodes(source, variants) {
    const present = new Set(variants.map(v => v.code));
    const reserved = new Set();
    for (const match of source.matchAll(/^\s*\/\/\s*(\d+)\s+(?:is\s+)?reserved/gim)) {
        const code = Number(match[1]);
        if (!present.has(code)) reserved.add(code);
    }
    return [...reserved].sort((a, b) => a - b);
}

/**
 * Find where a variant is raised.
 *
 * Matches `Err(<Enum>::Variant)` and `Err(Self::Variant)` — the contracts use the enum
 * name directly, so anchoring on `Self::` alone found nothing and every row of the
 * generated table read `—`. Then walks backwards for the nearest enclosing guard line or
 * explanatory `//` comment, which is the condition that produced the error.
 */
/**
 * Reduce a contract source to its production region.
 *
 * `#[cfg(test)] mod test;` is a *declaration*, so it can appear anywhere — the governance
 * contract puts its at the top of the file, ahead of the error enum. Treating it as the
 * start of a test region truncated that whole contract and left every `Raised in` cell
 * blank. So: drop bodyless test-module declarations, and only cut the source at an inline
 * `mod tests { ... }` block, which genuinely runs to end of file.
 */
function productionSource(source) {
    const withoutDeclarations = source.replace(/^[ \t]*#\[cfg\(test\)\][ \t]*\r?\n[ \t]*(?:pub )?mod [A-Za-z_]\w*;[ \t]*\r?\n/gm, '');

    const inline = /^(?:pub )?mod [A-Za-z_]\w*\s*\{/m.exec(withoutDeclarations);
    return inline ? withoutDeclarations.slice(0, inline.index) : withoutDeclarations;
}

function findRaiseSites(source, variant, enumName) {
    const lines = source.split('\n');
    const sites = [];
    // Matches every use of the variant by path, which covers all three ways the
    // contracts raise one: `return Err(PoolError::X)`, `.ok_or(PoolError::X)`, and a
    // `match` arm that yields it. The variant's own declaration line is excluded below.
    const needle = new RegExp(`(?:(?:Self|${enumName})::)${variant.name}\\b`);
    const declaration = new RegExp(`^\\s{4}${variant.name}\\s*=`);

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('//')) continue;
        if (declaration.test(lines[i])) continue;
        if (!needle.test(lines[i])) continue;

        // Nearest preceding function
        let fn = '—';
        for (let j = i; j >= 0; j--) {
            const fnMatch = /pub fn (\w+)|fn (\w+)/.exec(lines[j]);
            if (fnMatch) {
                fn = fnMatch[1] ?? fnMatch[2];
                break;
            }
        }

        // Nearest preceding guard or explanatory comment, within a few lines
        let guard = '';
        for (let j = i; j >= Math.max(0, i - 12); j--) {
            const line = lines[j].trim();
            if (/^\/\/\//.test(line)) continue;
            if (/^\/\//.test(line)) {
                guard = line.replace(/^\/\/+\s?/, '');
                break;
            }
            if (/^(if |let .* else|\}\s*else if|else if|\} else)/.test(line)) {
                guard = line.replace(/\{\s*$/, '').trim();
                break;
            }
        }
        sites.push({ fn, guard });
    }
    return sites;
}

async function readSource(relative) {
    return fs.readFile(path.join(ROOT, relative), 'utf8');
}

function escapeCell(text) {
    return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 150);
}

async function build() {
    const sections = [];
    let totalContract = 0;
    const allCodes = [];
    /** Every numbering defect found, so `--check` can fail on them and not only on drift. */
    const allProblems = [];

    for (const contract of CONTRACTS) {
        const file = `contracts/${contract.dir}/src/lib.rs`;
        const source = await readSource(file);
        const parsed = parseErrorEnum(source, file);
        parsed.source = productionSource(parsed.source);
        totalContract += parsed.variants.length;

        const problems = [];
        if (parsed.duplicateCodes.length) {
            problems.push(`duplicate codes: ${[...new Set(parsed.duplicateCodes)].join(', ')}`);
        }
        if (parsed.duplicateNames.length) {
            problems.push(`duplicate variant names: ${[...new Set(parsed.duplicateNames)].join(', ')}`);
        }
        const gaps = [];
        const sorted = [...parsed.variants].sort((a, b) => a.code - b.code);
        for (let i = 1; i < sorted.length; i++) {
            for (let missing = sorted[i - 1].code + 1; missing < sorted[i].code; missing++) {
                gaps.push(missing);
            }
        }
        const reserved = reservedCodes(source, parsed.variants);
        for (const code of reserved) {
            if (!gaps.includes(code)) problems.push(`code ${code} is documented as reserved but is a gap`);
        }
        const undocumentedGaps = gaps.filter(code => !reserved.includes(code));
        for (const code of undocumentedGaps) {
            problems.push(
                `code ${code} is unassigned and not documented as reserved — add a ` +
                    '`// <code> is reserved ...` comment so the gap is not silently reused',
            );
        }

        allCodes.push({ contract: contract.name, enumName: parsed.enumName, variants: parsed.variants });

        sections.push(`### ${contract.name} — \`${parsed.enumName}\``);
        sections.push('');
        sections.push(`Declared in [\`${file}\`](../${file}).`);
        sections.push('');
        for (const problem of problems) allProblems.push(`${contract.name}: ${problem}`);
        if (problems.length) {
            sections.push('> **Numbering problems**');
            for (const problem of problems) sections.push(`> - ${problem}`);
            sections.push('');
        } else {
            sections.push(
                `Codes are contiguous${reserved.length ? ` except for the explicitly reserved ${reserved.join(', ')}` : ''}.`,
            );
            sections.push('');
        }
        sections.push('| Code | Variant | Raised in | Guard / condition |');
        sections.push('|---:|---|---|---|');
        for (const variant of parsed.variants) {
            const sites = findRaiseSites(source, variant, parsed.enumName);
            const fns = [...new Set(sites.map(s => s.fn))].filter(f => f !== '—');
            const guard = sites.map(s => s.guard).find(Boolean) ?? '';
            sections.push(
                `| \`${variant.code}\` | \`${variant.name}\` | ` +
                    `${fns.length ? fns.map(f => `\`${f}\``).join(', ') : '—'} | ${guard ? escapeCell(guard) : '—'} |`,
            );
        }
        sections.push('');
    }

    // ── backend ──────────────────────────────────────────────────────────────
    const backendFile = 'backend/src/errors/errorCodes.ts';
    const backendSource = await readSource(backendFile);
    const backendCodes = [...backendSource.matchAll(/^\s{2}(\w+)\s*=\s*'(\w+)',/gm)].map(m => ({
        name: m[1],
        code: m[2],
    }));
    const backendRegistry = [...backendSource.matchAll(/\[ErrorCode\.(\w+)\]:\s*\{([\s\S]*?)\n  \},/g)].map(
        m => {
            const body = m[2];
            const status = /httpStatus:\s*(\d+)/.exec(body);
            const description = /description:\s*'([^']*)'/.exec(body);
            const action = /suggestedAction:\s*'([^']*)'/.exec(body);
            return {
                name: m[1],
                httpStatus: status ? Number(status[1]) : undefined,
                description: description ? description[1] : '',
                action: action ? action[1] : '',
            };
        },
    );
    const withMeta = new Map(backendRegistry.map(entry => [entry.name, entry]));

    const missingMeta = backendCodes.filter(code => !withMeta.has(code.name));
    const orphanMeta = backendRegistry.filter(entry => !backendCodes.some(c => c.name === entry.name));

    const backendSection = [];
    backendSection.push(`### API error codes — \`ErrorCode\``);
    backendSection.push('');
    backendSection.push(
        `Declared in [\`${backendFile}\`](../${backendFile}) with metadata for each code. ` +
            'The registry is what gives an integrator something to act on; a code the API can ' +
            'return without an entry here is a code whose meaning a client has to guess.',
    );
    backendSection.push('');
    if (missingMeta.length) {
        backendSection.push(
            `> **${missingMeta.length} code(s) with no registry entry**: ${missingMeta.map(c => `\`${c.code}\``).join(', ')}`,
        );
        backendSection.push('');
        for (const code of missingMeta) {
            allProblems.push(`API: ${code.code} is returned by the enum but has no registry entry`);
        }
    }
    if (orphanMeta.length) {
        backendSection.push(
            `> **${orphanMeta.length} registry entry(ies) with no enum member**: ${orphanMeta.map(c => `\`${c.name}\``).join(', ')}`,
        );
        backendSection.push('');
        for (const entry of orphanMeta) {
            allProblems.push(`API: registry entry ${entry.name} has no matching enum member`);
        }
    }
    backendSection.push('| Code | HTTP | Meaning | What a client should do |');
    backendSection.push('|---|---:|---|---|');
    for (const code of [...backendCodes].sort((a, b) => a.code.localeCompare(b.code))) {
        const meta = withMeta.get(code.name);
        backendSection.push(
            `| \`${code.code}\` | ${meta?.httpStatus ?? '—'} | ${escapeCell(meta?.description ?? '—')} | ${escapeCell(
                meta?.action ?? '—',
            )} |`,
        );
    }
    backendSection.push('');

    const total = totalContract + backendCodes.length;

    const header = [
        '# Error codes',
        '',
        '> **Generated file.** Do not edit it by hand: run',
        '> `node scripts/generate-error-codes.mjs`. `node scripts/generate-error-codes.mjs --check`',
        '> runs in CI and fails when this file is out of date, which is also how a duplicate or',
        '> unassigned code is caught.',
        '',
        `**${total} codes** — ${totalContract} across four contracts, ${backendCodes.length} on the API.`,
        '',
        '## Why this matters',
        '',
        'A Soroban contract reports a failure as `Error(Contract, #13)`. That number is the entire',
        'explanation the chain gives, so the name, the trigger, and the recovery all have to come',
        'from documentation like this. On the API side the same applies to a code a client switches',
        'on: a numeric status alone cannot distinguish "retry in a moment" from "this will never',
        'succeed".',
        '',
        'Codes are permanent. Once a variant has been deployed, its number is part of the ABI — a',
        'reassignment silently changes the meaning of every log, alert, and client branch that',
        'already refers to it. Add new codes; do not renumber old ones.',
        '',
        '## Contract error codes',
        '',
        'These are the `#[contracterror]` enums. Each is returned as `Error(Contract, <code>)`',
        'inside a failed invocation, and simulation reports the code without needing a ledger.',
        '',
        '| Contract | Enum | Codes |',
        '|---|---|---:|',
    ];
    for (const section of allCodes) {
        header.push(`| ${section.contract} | \`${section.enumName}\` | ${section.variants.length} |`);
    }
    header.push('| API | `ErrorCode` | ' + backendCodes.length + ' |');
    header.push('');

    return {
        markdown:
            header.join('\n') +
            '\n' +
            sections.join('\n') +
            '## API error codes\n\n' +
            backendSection.join('\n'),
        problems: allProblems,
    };
}

const { markdown: generated, problems } = await build();

if (check) {
    let existing = '';
    try {
        existing = await fs.readFile(OUT, 'utf8');
    } catch {
        existing = '';
    }
    if (existing.trim() !== generated.trim()) {
        console.error(
            '\n  docs/ERROR_CODES.md is out of date.\n' +
                '  Run `node scripts/generate-error-codes.mjs` and commit the result.\n',
        );
        process.exit(1);
    }
    // Drift is not the only failure worth gating on. A duplicate code, an unassigned gap and
    // a code the API can return without a documented meaning are all defects that the
    // regeneration alone would happily bake into the file, so `--check` refuses them here
    // rather than leaving them as a note a reader might scroll past.
    if (problems.length) {
        console.error('\n  The error-code surface has numbering problems:\n');
        for (const problem of problems) console.error(`    - ${problem}`);
        console.error('');
        process.exit(1);
    }
    console.log('\nError-code registry is current.\n');
} else {
    await fs.writeFile(OUT, generated);
    const lines = generated.split('\n').length;
    console.log(`\nWrote docs/ERROR_CODES.md (${lines} lines).\n`);
}
