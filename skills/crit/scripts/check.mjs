#!/usr/bin/env node
// crit: the gate a critique passes before the user sees it. It is deterministic on purpose: a critique
// loop converges only when something outside the critic says what is wrong.
//
//   check.mjs <critique.md> --refs <a.md> [<b.md> ...] [--evidence <dir>] [--verify <verify.md>]
//             [--report <check.txt>] [--json]
//   check.mjs --selftest
//
// Exit 0 means pass, 1 means the critique failed, 2 means the gate itself couldn't run. --report
// writes the report to a file on every exit, so no shell redirect (or permission prompt) is needed
// and an old pass is never left behind.
//
// Fails when:
//   - a quoted rule (a **Rule:** or **Honors:** line) is not word for word in the file and section it
//     cites: a paraphrase, an invention, the right words under the wrong heading, fragments stitched
//     across paragraphs, or a quote that drops the "never" or "no" in front of it;
//   - a P0/P1/P2 finding lacks **Where:**, **Rule:**, **What's wrong:** or **Fix:**, or a finding is
//     written without a ### heading;
//   - a judgment call sits in a severity section, carries a **Rule:**, or has no **Where:**;
//   - the verdict is missing, unknown, or contradicts the findings;
//   - a required section is missing, or the critique names a capture file that doesn't exist;
//   - a P0/P1/P2 **Where:** line names no element, quotes page text that isn't on the page, or names a
//     selector that matches no element in page.html;
//   - with --verify: verify.md lacks a line for a P0 or P1 finding, has a line naming no finding, doesn't
//     close with "nothing missed" or missed lines, or has a fix, severity, refuted, verdict or missed
//     line. Converged means this gate passes with --verify.
//
// Quote marks, emphasis, links, dashes, case and whitespace are normalised on both sides. A quote is
// tried whole first, so a rule that contains "..." can be quoted as it stands; otherwise one "..."
// may join two fragments of one paragraph or list item, three words or more each, in order.
// The citation form is **Rule:** "<verbatim>" (<file>.md § <section>); the dash form is accepted too.
// A section is named by its heading, its number, or both ("§ 7 Radii" for Radii under section 7).

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const VERDICTS = ['ship as-is', 'ship after p0s', 'back to drawing board'];
const REQUIRED = [
  ['P0', '## P0: must fix'], ['P1', '## P1: should fix'], ['P2', '## P2: polish'],
  ['judgment', '## Judgment calls'], ['working', '## Working well'], ['notchecked', '## Not checked'],
];
const NEGATION = /(?:^|[^a-z0-9])(never|no|not|dont|cannot|cant|avoid|without|nor)[\s,:;]*$/;
const CAPTURE_FILE = /^(?:\d+-(?:fold|full-\d+)\.png|text(?:-\d+)?\.txt|page\.html|evidence\.json)$/i;
const HEX = /^#[0-9a-f]{3,8}$/i;
const FILE_NAME = /\.(md|png|jpe?g|webp|json|txt|html?|css|js|mjs|php|swift)$/i;

export const normText = s => String(s)
  .split('\n')
  .map(l => l.replace(/^\s*(>\s*)+/, '').replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^#{1,6}\s+/, ''))
  .join(' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\|/g, ' ')
  .replace(/[*_`~]/g, '')
  .replace(/["'“”‘’„«»]/g, '')
  .replace(/[–—−]/g, '-')
  .replace(/…/g, '...')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

// Headings keep their leading number ("5. Writing style" is section 5), so this does not reuse
// normText, which strips "5. " as a list marker.
const normKey = s => String(s)
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`~"'“”‘’]/g, '')
  .replace(/§/g, ' ')
  .toLowerCase()
  .replace(/^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)/, '$1')
  .replace(/[^a-z0-9.\s-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const trimPunct = s => s.replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, '');
const words = s => (s ? s.split(' ').length : 0);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normTitle = s => normText(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// A paragraph or a list item is one block: "..." may not join text across two of them.
function blocksOf(lines) {
  const blocks = [];
  let cur = [];
  const flush = () => { if (cur.length) blocks.push(normText(cur.join('\n'))); cur = []; };
  for (const l of lines) {
    if (!l.trim()) { flush(); continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l) || /^#{1,6}\s/.test(l) || /^\s*\|/.test(l)) flush();
    cur.push(l);
  }
  flush();
  return blocks;
}

function loadRef(path) {
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const m = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (m) heads.push({ level: m[1].length, text: m[2], line: i });
  });
  const spans = heads.map((h, k) => {
    let end = lines.length;
    for (let j = k + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].line; break; }
    const key = normKey(h.text);
    const num = (key.match(/^(\d+(?:\.\d+)*)(?=\s|$)/) || [])[1] || null;
    const ancestors = [];
    for (let j = k - 1, lvl = h.level; j >= 0; j--) if (heads[j].level < lvl) { ancestors.push(heads[j]); lvl = heads[j].level; }
    return {
      heading: h.text, level: h.level, key, num, name: num ? key.slice(num.length).trim() : key,
      ancestorNums: ancestors.map(a => (normKey(a.text).match(/^(\d+(?:\.\d+)*)(?=\s|$)/) || [])[1]).filter(Boolean),
      blocks: blocksOf(lines.slice(h.line, end)),
    };
  });
  const firstHead = heads.length ? heads[0].line : lines.length;
  if (firstHead > 0) {
    spans.unshift({ heading: 'frontmatter', level: 0, key: 'frontmatter', num: null, name: 'frontmatter', ancestorNums: [], blocks: blocksOf(lines.slice(0, firstHead)) });
  }
  return { path, name: basename(path), spans, hasSubsections: heads.some(h => h.level >= 2) };
}

function sectionsFor(ref, cited) {
  const c = normKey(cited);
  if (!c) return [];
  if (c === 'frontmatter' || c === 'front matter') return ref.spans.filter(s => s.key === 'frontmatter');
  const m = c.match(/^(\d+(?:\.\d+)*)(?:\s+(.*))?$/);
  const num = m ? m[1] : null, rest = m ? (m[2] || '') : '';
  // The document's title spans the whole file, so it can't stand in for a section.
  return ref.spans.filter(s => s.key !== 'frontmatter' && !(s.level === 1 && ref.hasSubsections)).filter(s =>
    s.key === c
    || s.name === c
    || (num && !rest && s.num === num)
    || (num && rest && s.name === rest && (s.num === num || s.ancestorNums.includes(num))));
}

// Where a quote sits in a block, with word boundaries: the whole quote first, then two fragments.
function findIn(block, quote) {
  const at = (frag, from = 0) => {
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(frag)}(?![a-z0-9])`, 'g');
    re.lastIndex = from;
    const m = re.exec(block);
    return m ? m.index : -1;
  };
  const whole = trimPunct(normText(quote));
  if (words(whole) >= 3) {
    const i = at(whole);
    if (i >= 0) return i;
  }
  const frags = normText(quote).split('...').map(trimPunct).filter(Boolean);
  if (frags.length !== 2 || frags.some(f => words(f) < 3)) return -1;
  const i = at(frags[0]);
  if (i < 0) return -1;
  return at(frags[1], i + frags[0].length) >= 0 ? i : -1;
}

const locate = (refs, quote) => {
  for (const ref of refs) {
    const hits = ref.spans.filter(s => s.blocks.some(b => findIn(b, quote) >= 0));
    if (!hits.length) continue;
    const inner = hits.reduce((best, s) => (!best || s.level > best.level ? s : best), null);
    return { ref, heading: inner.heading };
  }
  return null;
};

export function checkCitation(refs, quote, file, section) {
  const whole = trimPunct(normText(quote));
  const frags = normText(quote).split('...').map(trimPunct).filter(Boolean);
  if (!whole) return 'the quote is empty';
  if (words(whole) < 3 && (frags.length < 2 || frags.some(f => words(f) < 3))) return `"${quote}" is too short to verify; quote three words or more`;
  const ref = refs.find(r => r.name.toLowerCase() === basename(file).toLowerCase());
  if (!ref) return `cites ${file}, which is not one of the reference files (${refs.map(r => r.name).join(', ')})`;
  const found = locate([ref], quote);
  if (!found) {
    const elsewhere = locate(refs.filter(r => r !== ref), quote);
    if (elsewhere) return `the quote is in ${elsewhere.ref.name} § ${elsewhere.heading}, not ${ref.name}`;
    if (frags.length > 2) return 'joins more than two fragments with "..."; quote one rule, at most two parts of one paragraph or list item';
    return `the quote is not word for word in any reference file (paraphrased, stitched across paragraphs, or invented): "${quote.slice(0, 120)}"`;
  }
  const spans = sectionsFor(ref, section);
  if (!spans.length) return `${ref.name} has no section "${section}"; name it by its heading or number (the quote is under § ${found.heading})`;
  for (const s of spans) {
    for (const b of s.blocks) {
      const i = findIn(b, quote);
      if (i < 0) continue;
      const neg = b.slice(Math.max(0, i - 24), i).match(NEGATION);
      if (neg) return `the quote leaves out the "${neg[1]}" in front of it, which reverses the rule`;
      return null;
    }
  }
  return `the quote is in ${ref.name} but under § ${found.heading}, not § ${section}`;
}

const kindOf = t => {
  const s = t.trim().toLowerCase();
  if (/^p0\b/.test(s)) return 'P0';
  if (/^p1\b/.test(s)) return 'P1';
  if (/^p2\b/.test(s)) return 'P2';
  if (s.startsWith('judgment') || s.startsWith('judgement')) return 'judgment';
  if (s.startsWith('working well')) return 'working';
  if (s.startsWith('not checked')) return 'notchecked';
  if (s.startsWith('since last round')) return 'since';
  if (s.startsWith('rule gaps')) return 'gaps';
  return 'other';
};

function parseCritique(md) {
  const doc = { verdict: null, sections: [] };
  let sec = null, find = null, fence = false;
  md.split('\n').forEach((text, i) => {
    const n = i + 1;
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    if (fence) return;
    const v = text.match(/^\s*\*\*Verdict:\*\*\s*(.+)$/i);
    if (v && doc.verdict === null) doc.verdict = { value: v[1].trim(), n };
    const h2 = text.match(/^##\s+(.*)$/);
    if (h2) {
      sec = { title: h2[1].trim(), kind: kindOf(h2[1]), findings: [], lines: [], n };
      doc.sections.push(sec);
      find = null;
      return;
    }
    const h3 = text.match(/^###\s+(.*)$/);
    if (h3 && sec) {
      find = { title: h3[1].trim(), lines: [], n };
      sec.findings.push(find);
      return;
    }
    (find ? find.lines : sec ? sec.lines : []).push({ text, n });
  });
  return doc;
}

const CITE_PAREN = /^["“](.+)["”]\s*\(\s*([\w.\/-]+?\.md)\s*§\s*(.+?)\s*\)\s*[.;,]?\s*$/;
const CITE_DASH = /^["“](.+)["”]\s*[—–-]{1,2}\s*([\w.\/-]+?\.md)\s*§\s*(.+?)\s*$/;
const LABEL = /^\s*(?:[-*]\s+)?\*\*(Rule|Honors):\*\*\s*(.*)$/i;
const FIELD = /^\s*(?:[-*]\s+)?\*\*(Where|Rule|What['’]s wrong|Fix|Observation|Why it matters|Possible fix):\*\*/i;
const has = (lines, label) => lines.some(l => new RegExp(`^\\s*(?:[-*]\\s+)?\\*\\*${label}:\\*\\*`, 'i').test(l.text));

// The page as captured: its visible text at every width, and the rendered DOM.
function loadEvidence(dir) {
  if (!dir || !existsSync(dir)) return null;
  const text = readdirSync(dir).filter(f => /^text(-\d+)?\.txt$/.test(f))
    .map(f => normText(readFileSync(join(dir, f), 'utf8'))).join(' | ');
  const htmlPath = join(dir, 'page.html');
  return { text, html: existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '' };
}

// One compound selector ("a.btn.primary", "#hero", "section") has to match a single element.
function elementExists(html, compound) {
  const tag = (compound.match(/^[a-z][a-z0-9-]*/i) || [])[0];
  const classes = (compound.match(/\.[\w-]+/g) || []).map(c => c.slice(1));
  const id = ((compound.match(/#[\w-]+/) || [])[0] || '').slice(1);
  const open = new RegExp(`<${tag ? escapeRe(tag) : '[a-z][a-z0-9-]*'}(?=[\\s>/])[^>]*>`, 'gi');
  for (const m of html.matchAll(open)) {
    const cls = ((m[0].match(/\bclass\s*=\s*["']([^"']*)["']/i) || [])[1] || '').split(/\s+/);
    const idv = (m[0].match(/\bid\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (classes.every(c => cls.includes(c)) && (!id || idv === id)) return true;
  }
  return false;
}

const COMPOUND = /^(?:[a-z][a-z0-9-]*)?(?:[.#][a-z_-][\w-]*)*$/i;

// What a Where line claims about the page must be on the page.
function checkWhere(line, ev, requireElement) {
  const problems = [];
  const body = line.replace(/^\s*(?:[-*]\s+)?\*\*Where:\*\*/i, '');
  let elements = 0;
  for (const m of body.matchAll(/["“]([^"”]+)["”]/g)) {
    elements++;
    if (!ev.text) continue;
    const whole = trimPunct(normText(m[1]));
    const frags = normText(m[1]).split('...').map(trimPunct).filter(Boolean);
    const ok = (whole && ev.text.includes(whole))
      || (frags.length === 2 && frags.every(f => words(f) >= 2) && ev.text.indexOf(frags[1], ev.text.indexOf(frags[0]) + 1) > ev.text.indexOf(frags[0]) && ev.text.indexOf(frags[0]) >= 0);
    if (!ok) problems.push(`quotes page text "${m[1].slice(0, 80)}" that is not in the captured text`);
  }
  for (const m of body.matchAll(/`([^`]+)`/g)) {
    const s = m[1].trim();
    if (HEX.test(s) || FILE_NAME.test(s)) continue;
    const parts = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
    if (!parts.length || !parts.every(p => COMPOUND.test(p)) || !/[.#]/.test(s) && !/^[a-z][a-z0-9-]*$/i.test(s)) continue;
    elements++;
    if (!ev.html) continue;
    for (const p of parts) if (!elementExists(ev.html, p)) problems.push(`names selector \`${s}\`, but no element matches \`${p}\` in page.html`);
  }
  // A page-wide finding (one typeface everywhere, no images at all) points at a measurement instead.
  if (requireElement && !elements && !/evidence\.json/i.test(body)) {
    problems.push('names no element; quote its page text in double quotes, give its selector in backticks, or cite the evidence.json measurement a page-wide finding rests on');
  }
  return problems;
}

// The verifier's lines: "- holds: <title>", "- fix: <title>: <detail>", "- severity: <title>: ...",
// "- refuted: <title>: <why>", "- unsure: <title>: <what would settle it>", "- verdict: should be ...",
// "- missed: <what>", and a closing "- nothing missed". Only list items count, so prose can't block.
const VERIFY_LINE = /^\s*[-*]\s+(holds|fix|severity|refuted|unsure|verdict|missed)\s*:\s*(.*)$/i;
const NOTHING_MISSED = /^\s*[-*]\s+(?:nothing missed|missed\s*:\s*(?:none|nothing|n\/a))\.?\s*$/i;

function matchTitle(subject, titles) {
  const a = normTitle(subject);
  const exact = titles.find(t => a === t.norm || a.startsWith(`${t.norm} `));
  if (exact) return exact;
  const toks = new Set(a.split(' ').slice(0, 30));
  let best = null, score = 0;
  for (const t of titles) {
    const tt = t.norm.split(' ');
    const share = tt.filter(w => toks.has(w)).length / tt.length;
    if (share > score) { best = t; score = share; }
  }
  return score >= 0.75 ? best : null;
}

function checkVerify(text, findings, fail, warnings) {
  const titles = findings.map(f => ({ ...f, norm: normTitle(f.title), judged: 0 }));
  const lines = text.split('\n').map((t, i) => ({ t, n: i + 1 }));
  let closed = false;
  for (const l of lines) {
    if (NOTHING_MISSED.test(l.t)) { closed = true; continue; }
    const m = l.t.match(VERIFY_LINE);
    if (!m) continue;
    const kind = m[1].toLowerCase(), rest = m[2].trim();
    if (kind === 'missed') { closed = true; fail(0, `verifier, verify.md line ${l.n}: missed: ${rest.slice(0, 300)}`); continue; }
    if (kind === 'verdict') { fail(0, `verifier, verify.md line ${l.n}: verdict: ${rest.slice(0, 300)}`); continue; }
    const t = matchTitle(rest, titles);
    if (!t) { fail(0, `verify.md form: line ${l.n} names no P0 or P1 finding ("${rest.slice(0, 80)}"); run verify again`); continue; }
    t.judged++;
    if (kind === 'unsure') warnings.push(`verifier is unsure about "${t.title}": ${rest.slice(0, 200)}`);
    else if (kind !== 'holds') fail(0, `verifier, verify.md line ${l.n}: ${kind}: ${rest.slice(0, 300)}`);
  }
  for (const t of titles) if (!t.judged) fail(0, `verify.md form: no line for ${t.kind} "${t.title}"; run verify again`);
  if (!closed) fail(0, 'verify.md form: it must end with "- nothing missed" or "- missed: ..." lines; run verify again');
}

export function check(md, refPaths, evidenceDir, verifyText = null) {
  const refs = refPaths.map(loadRef);
  const doc = parseCritique(md);
  const ev = loadEvidence(evidenceDir);
  const failures = [], warnings = [];
  const fail = (n, msg) => failures.push({ line: n, message: msg });
  const counts = { P0: 0, P1: 0, P2: 0, judgment: 0, citations: 0 };
  const severe = [];

  for (const [kind, label] of REQUIRED) {
    if (!doc.sections.some(s => s.kind === kind)) fail(0, `missing section "${label}" (write "None." when it is empty)`);
  }

  for (const sec of doc.sections) {
    const all = [...sec.lines, ...sec.findings.flatMap(f => [{ text: `### ${f.title}`, n: f.n }, ...f.lines])];
    for (const l of all) {
      const m = l.text.match(LABEL);
      if (!m) continue;
      const c = m[2].trim().match(CITE_PAREN) || m[2].trim().match(CITE_DASH);
      if (!c) { fail(l.n, `a **${m[1]}:** line is not in the form "<verbatim quote>" (<file>.md § <section>)`); continue; }
      counts.citations++;
      const problem = checkCitation(refs, c[1], c[2], c[3]);
      if (problem) fail(l.n, problem);
    }

    const findingSection = ['P0', 'P1', 'P2', 'judgment'].includes(sec.kind);
    if (findingSection) {
      for (const l of sec.lines) if (FIELD.test(l.text)) fail(l.n, `a finding in ${sec.title.split(/[:(]/)[0].trim()} is written without a ### heading; give every finding its own ### title`);
    }

    if (['P0', 'P1', 'P2'].includes(sec.kind)) {
      counts[sec.kind] += sec.findings.length;
      if (sec.kind !== 'P2') for (const f of sec.findings) severe.push({ kind: sec.kind, title: f.title });
      for (const l of all) if (/\[judge?ment call\]/i.test(l.text)) fail(l.n, `a judgment call sits in ${sec.kind}; judgment calls go only under "## Judgment calls"`);
      for (const f of sec.findings) {
        for (const label of ['Where', 'Rule', "What[’']s wrong", 'Fix']) {
          if (!has(f.lines, label)) fail(f.n, `${sec.kind} "${f.title}" has no **${label.replace(/\[.*?\]/, "'")}:** line`);
        }
      }
      if (!sec.findings.length && !sec.lines.some(l => l.text.trim())) fail(sec.n, `${sec.kind} is empty; write "None."`);
    }

    if (ev && findingSection) {
      for (const f of sec.findings) {
        for (const l of f.lines) {
          if (/^\s*(?:[-*]\s+)?\*\*Where:\*\*/i.test(l.text)) {
            for (const p of checkWhere(l.text, ev, sec.kind !== 'judgment')) fail(l.n, `"${f.title}" ${p}`);
          }
        }
      }
    }

    if (sec.kind === 'judgment') {
      counts.judgment += sec.findings.length;
      for (const f of sec.findings) {
        if (has(f.lines, 'Rule')) fail(f.n, `judgment call "${f.title}" carries a **Rule:**; a finding with a verbatim rule belongs in P0, P1 or P2`);
        if (!has(f.lines, 'Where')) fail(f.n, `judgment call "${f.title}" has no **Where:** line`);
      }
    }

    if (sec.kind === 'working' && !sec.lines.some(l => l.text.trim()) && !sec.findings.length) {
      fail(sec.n, 'Working well is empty; name what works and must survive the fixes, or say why nothing does');
    }
  }

  if (!doc.verdict) fail(0, 'no **Verdict:** line');
  else {
    const v = doc.verdict.value.toLowerCase().replace(/[*`]/g, '').replace(/[.!]+$/, '').replace('ship as is', 'ship as-is').trim();
    if (!VERDICTS.includes(v)) fail(doc.verdict.n, `verdict "${doc.verdict.value}" is not one of: ship as-is, ship after P0s, back to drawing board`);
    else if (counts.P0 > 0 && v === 'ship as-is') fail(doc.verdict.n, `verdict "ship as-is" with ${counts.P0} P0 finding(s)`);
    else if (counts.P0 === 0 && v !== 'ship as-is') fail(doc.verdict.n, `verdict "${doc.verdict.value}" with no P0 findings; judgment calls never set the verdict`);
  }

  if (evidenceDir) {
    const named = new Set((md.replace(/[a-z]+:\/\/\S+/gi, '').match(/[\w.-]+\.(?:png|txt|html|json)\b/gi) || []).filter(f => CAPTURE_FILE.test(f)));
    for (const f of named) if (!existsSync(join(evidenceDir, f))) fail(0, `cites capture file ${f}, which is not in ${evidenceDir}`);
  } else {
    warnings.push('no --evidence directory given, so the page text, selectors and capture files the critique names were not checked');
  }
  if (!/^\s*\*\*Fix first:\*\*/im.test(md)) warnings.push('no **Fix first:** line under the verdict');
  if (!/^\s*\*\*Answer:\*\*/im.test(md)) warnings.push('no **Answer:** line answering what the user asked');
  const total = counts.P0 + counts.P1 + counts.P2;
  if (total > 8) warnings.push(`${total} findings in P0 to P2; group the ones that share a rule or a fix (the cap is 8)`);
  if (counts.judgment > 3) warnings.push(`${counts.judgment} judgment calls; keep the 3 that matter most to the brief`);
  if (verifyText !== null) checkVerify(verifyText, severe, fail, warnings);

  return {
    refs: refs.map(r => ({ name: r.name, sections: r.spans.filter(s => s.key !== 'frontmatter').length })),
    counts, failures, warnings, ok: failures.length === 0,
  };
}

function report(file, r) {
  const lines = [`crit check: ${file}`];
  lines.push(`  refs: ${r.refs.map(x => `${x.name} (${x.sections} sections)`).join(', ')}`);
  lines.push(`  findings: P0 ${r.counts.P0} · P1 ${r.counts.P1} · P2 ${r.counts.P2} · judgment ${r.counts.judgment} · citations checked ${r.counts.citations}`);
  for (const f of r.failures) lines.push(`  FAIL ${f.line ? `line ${f.line}: ` : ''}${f.message}`);
  for (const w of r.warnings) lines.push(`  warn ${w}`);
  lines.push(r.ok ? '  result: pass' : `  result: ${r.failures.length} failure(s)`);
  return lines.join('\n');
}

function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'crit-check-'));
  const taste = join(dir, 'taste.md');
  writeFileSync(taste, [
    '# taste.md', '', '## The root', '',
    '- **The test for beautiful:** "I keep coming back to it because I *want* to."', '',
    '## The kill list', '',
    '- **An unclear call to action.** People should know instantly what you want them to do next: one proper call to action, driving them from page to page.',
    '- **Empty states with no guidance.** They fail at the moment the user needs direction.', '',
    '## Soul', '', '- **Humor is charm, never gallows.** Error messages can be funny, but they have to be clear.', '',
    '## Shadows', '', 'Never use drop shadows for elevation. Use a 1px solid border instead.', '',
    '## Openers', '', 'Avoid openers like In a world where... in any headline.', '',
  ].join('\n'));
  const design = join(dir, 'DESIGN.md');
  writeFileSync(design, [
    '---', 'tokens:', '  brand: "#E54D4D"', 'note: brand red is the only accent on any page', '---', '', '# DESIGN', '',
    '## 5. Writing style', '', 'Never use exclamation points in UI copy.', '',
    '## 7. Visual system', '', '### Radii', '', 'Cards use 8px corners on every surface.', '',
    '### Elevation', '', 'Use colored shadows for emphasis on hero CTAs.', '',
    '### 10.3 Product-specific laws', '', 'One surface, one purpose.', '',
  ].join('\n'));
  writeFileSync(join(dir, '390-fold.png'), '');
  writeFileSync(join(dir, 'evidence.json'), '{}');
  writeFileSync(join(dir, 'text-390.txt'), 'Plan your workshop\nStart a plan\nSee an example');
  writeFileSync(join(dir, 'page.html'), '<main><section class="hero"><a class="btn btn-primary" href="/plan">Start a plan</a><a id="example" class="btn-secondary" href="/ex">See an example</a></section></main>');

  const WHERE = '390-fold.png, hero: "Start a plan" (`a.btn-primary`)';
  const cta = '"one proper call to action, driving them from page to page"';
  const finding = (rule, where = WHERE) => [
    '### Two filled buttons compete', `**Where:** ${where}`, rule,
    "**What's wrong:** Two filled buttons sit side by side.", '**Fix:** Make the second a text link.',
  ].join('\n');
  const doc = ({ verdict = 'ship after P0s', p0 = finding(`**Rule:** ${cta} (taste.md § The kill list)`), p1 = 'None.', judgment = 'None.', honors = '"They fail at the moment the user needs direction." (taste.md § The kill list)' } = {}) => [
    '# Crit: test', `**Verdict:** ${verdict}`, '**Answer:** No.', '**Fix first:** One filled button.', '',
    '## P0: must fix', p0, '', '## P1: should fix', p1, '', '## P2: polish', 'None.', '',
    '## Judgment calls (no rule covers these)', judgment, '',
    '## Working well: protect these', '- The empty state guides (390-fold.png)', `  **Honors:** ${honors}`, '',
    '## Not checked', '- Hover states.', '',
  ].join('\n');
  const rule = (quote, cite) => finding(`**Rule:** "${quote}" (${cite})`);
  const holds = '- holds: Two filled buttons compete\n- nothing missed';

  const cases = [
    ['a clean critique passes', doc(), true],
    ['the older dash form passes', doc({ p0: finding(`**Rule:** ${cta} — taste.md § The kill list`) }), true],
    ['a paraphrased rule fails', doc({ p0: rule('have one clear call to action per page', 'taste.md § The kill list') }), false],
    ['the right words under the wrong section fail', doc({ p0: finding(`**Rule:** ${cta} (taste.md § Soul)`) }), false],
    ['a rule cited to the wrong file fails', doc({ p0: finding(`**Rule:** ${cta} (DESIGN.md § 5)`) }), false],
    ['the document title as a section fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § taste.md)`) }), false],
    ['a fragment of a heading as a section fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § kill)`) }), false],
    ['two fragments of one item pass', doc({ p0: rule('People should know instantly ... one proper call to action', 'taste.md § The kill list') }), true],
    ['fragments out of order fail', doc({ p0: rule('one proper call to action ... People should know instantly', 'taste.md § The kill list') }), false],
    ['fragments from two list items fail', doc({ p0: rule('one proper call to action ... fail at the moment the user', 'taste.md § The kill list') }), false],
    ['three fragments fail', doc({ p0: rule('People should know instantly ... what you want them ... one proper call', 'taste.md § The kill list') }), false],
    ['a rule that contains "..." quoted whole passes', doc({ p0: rule('Avoid openers like In a world where... in any headline.', 'taste.md § Openers') }), true],
    ['dropping the "never" in front fails', doc({ honors: '"use drop shadows for elevation" (taste.md § Shadows)' }), false],
    ['the sentence after a "never" passes', doc({ honors: '"Use a 1px solid border instead." (taste.md § Shadows)' }), true],
    ['a section cited by number passes', doc({ p0: rule('Never use exclamation points in UI copy.', 'DESIGN.md § 5') }), true],
    ['a subsection named under its parent number passes', doc({ p0: rule('Cards use 8px corners on every surface.', 'DESIGN.md § 7 Radii') }), true],
    ['a numbered subsection by its full heading passes', doc({ p0: rule('One surface, one purpose.', 'DESIGN.md § 10.3 Product-specific laws') }), true],
    ['a quote from the frontmatter cited as frontmatter passes', doc({ p0: rule('brand red is the only accent on any page', 'DESIGN.md § frontmatter') }), true],
    ['a frontmatter quote cited to a section fails', doc({ p0: rule('brand red is the only accent on any page', 'DESIGN.md § 5') }), false],
    ['a quote with inner quote marks passes', doc({ p0: rule('The test for beautiful: "I keep coming back to it because I want to."', 'taste.md § The root') }), true],
    ['a citation line in neither form fails', doc({ p0: finding(`**Rule:** ${cta}, taste.md, The kill list`) }), false],
    ['a lowercase rule label is still checked', doc({ p0: finding('**rule:** "Every page must use a carousel." (taste.md § The kill list)') }), false],
    ['a finding without a ### heading fails', doc({ p0: `**1. Two filled buttons compete**\n**Where:** ${WHERE}\n**Rule:** ${cta} (taste.md § The kill list)\n**What's wrong:** x\n**Fix:** y` }), false],
    ['a judgment call inside P1 fails', doc({ p1: `### Feels heavy\n**Where:** ${WHERE}\n[judgment call] it feels heavy\n**Rule:** ${cta} (taste.md § The kill list)\n**What's wrong:** x\n**Fix:** y` }), false],
    ['ship as-is with a P0 fails', doc({ verdict: 'ship as-is' }), false],
    ['ship after P0s with no P0 fails', doc({ p0: 'None.' }), false],
    ['back to drawing board with no P0 fails', doc({ verdict: 'back to drawing board', p0: 'None.' }), false],
    ['a finding without a Fix fails', doc().replace('**Fix:** Make the second a text link.', ''), false],
    ['a missing capture file fails', doc().replace('390-fold.png, hero', '390-full-9.png, hero'), false],
    ['a file name that capture never writes is not checked', doc().replace('**Fix:** Make the second a text link.', '**Fix:** Use the token in workshopr-design-system.json.'), true],
    ['a judgment call with a Rule fails', doc({ judgment: `### Heavy\n**Where:** ${WHERE}\n**Rule:** ${cta} (taste.md § The kill list)` }), false],
    ['a judgment call without an element passes', doc({ judgment: '### Heavy\n**Where:** 390-fold.png, the hero\n**Observation:** heavy' }), true],
    ['a two-word quote fails', doc({ p0: rule('proper call', 'taste.md § The kill list') }), false],
    ['page text that is not on the page fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, hero: "Start your free trial" (`a.btn-primary`)') }), false],
    ['page text stitched from one-word fragments fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, hero: "Start ... example"') }), false],
    ['a selector that matches nothing fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, `a.btn-ghost`') }), false],
    ['a descendant selector with an invented class fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, `.hero .btn-ghost-invented`') }), false],
    ['a real descendant selector passes', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, `section.hero > a#example`') }), true],
    ['a class on the wrong tag fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, `section.btn-primary`') }), false],
    ['a hex colour and a file name in backticks are not selectors', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, `${WHERE}, fill \`#E85D04\`, see \`taste.md\``) }), true],
    ['a Where line that names no element fails', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, '390-fold.png, the hero') }), false],
    ['a page-wide finding that cites its measurement passes', doc({ p0: finding(`**Rule:** ${cta} (taste.md § The kill list)`, 'whole page: evidence.json type.families = Arial (22 elements)') }), true],
    ['a verifier who upholds everything passes', doc(), true, holds],
    ['a verifier fix line fails', doc(), false, '- fix: Two filled buttons compete: the second is outlined\n- nothing missed'],
    ['a verifier missed line fails', doc(), false, '- holds: Two filled buttons compete\n- missed: the footer CTA is a ghost button'],
    ['missed: none counts as nothing missed', doc(), true, '- holds: Two filled buttons compete\n- missed: none'],
    ['a verifier unsure line only warns', doc(), true, '- unsure: Two filled buttons compete: hover state not captured\n- nothing missed'],
    ['a verifier verdict line fails', doc(), false, '- holds: Two filled buttons compete\n- verdict: should be back to drawing board, the fix replaces the layout\n- nothing missed'],
    ['a verify.md in no known form fails', doc(), false, 'Looks good to me.'],
    ['a verifier who skips a P0 fails', doc(), false, '- nothing missed'],
    ['a holds line that names no finding fails', doc(), false, '- holds: looks right\n- holds: Two filled buttons compete\n- nothing missed'],
    ['a verify.md without a closing line fails', doc(), false, '- holds: Two filled buttons compete'],
    ['prose in verify.md is not read as a verdict line', doc(), true, `${holds}\nSeverity: both are rated correctly.`],
    ['a slightly reworded title still matches', doc(), true, '- holds: The two filled buttons compete\n- nothing missed'],
    ['a clean critique with nothing missed passes', doc({ verdict: 'ship as-is', p0: 'None.' }), true, '- nothing missed'],
  ];
  let bad = 0;
  for (const [name, md, expectOk, verifyText = null] of cases) {
    const r = check(md, [taste, design], dir, verifyText);
    const pass = r.ok === expectOk;
    if (!pass) bad++;
    console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${pass ? '' : `\n     ${r.failures.map(f => f.message).join('\n     ') || 'expected a failure, got none'}`}`);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(bad ? `${bad} of ${cases.length} cases failed` : `all ${cases.length} cases pass`);
  process.exit(bad ? 1 : 0);
}

const argv = process.argv.slice(2);
if (argv[0] === '--selftest') selftest();
else {
  const refs = [];
  let file = null, evidence = null, verify = null, reportTo = null, json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--refs') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) refs.push(argv[++i]); }
    else if (argv[i] === '--evidence') evidence = argv[++i];
    else if (argv[i] === '--verify') verify = argv[++i];
    else if (argv[i] === '--report') reportTo = argv[++i];
    else if (argv[i] === '--json') json = true;
    else if (!file) file = argv[i];
  }
  // An error is written to the report too, so a stale pass can never stand in for this run.
  const stop = msg => {
    const text = `crit check: ${file || '(no critique given)'}\n  ERROR ${msg}\n  result: error`;
    if (reportTo) writeFileSync(reportTo, `${text}\n`);
    console.error(text);
    process.exit(2);
  };
  if (!file || !refs.length) stop('usage: check.mjs <critique.md> --refs <a.md> [<b.md> ...] [--evidence <dir>] [--verify <verify.md>] [--report <check.txt>] [--json] | check.mjs --selftest');
  for (const p of [file, ...refs, ...(verify ? [verify] : []), ...(evidence ? [evidence] : [])]) if (!existsSync(p)) stop(`not found: ${p}`);
  let r;
  try {
    r = check(readFileSync(file, 'utf8'), refs, evidence, verify ? readFileSync(verify, 'utf8') : null);
  } catch (e) {
    stop(`the gate crashed: ${e.message}`);
  }
  const text = json ? JSON.stringify({ file, ...r }, null, 2) : report(file, r);
  if (reportTo) writeFileSync(reportTo, `${text}\n`);
  console.log(text);
  process.exit(r.ok ? 0 : 1);
}
