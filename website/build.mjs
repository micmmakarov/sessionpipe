// SPDX-License-Identifier: Apache-2.0
// sessionpipe.org: one Node script, no framework. Renders spec/*.md and the legal
// files with marked into one HTML template, copies schemas/v1 (the $ids), writes
// website/dist/. No analytics, no external requests, no cookies.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const _src = path.join(root, "website/src");
const out = path.join(root, "website/dist");
const SITE = "https://sessionpipe.org";
const read = (p) => readFileSync(path.join(root, p), "utf8");
const version = JSON.parse(read("packages/core/package.json")).version;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(path.join(root, "website/public"), out, { recursive: true });
mkdirSync(path.join(out, "schema/v1"), { recursive: true });
cpSync(path.join(root, "schemas/v1"), path.join(out, "schema/v1"), { recursive: true });

const css = read("website/src/site.css");
const nav = [
  ["/", "Home"],
  ["/protocol/", "Protocol"],
  ["/get-started/", "Get started"],
  ["/receivers/", "Receivers"],
  ["https://github.com/spacesheep-dev/sessionpipe", "GitHub"],
];

/** Spec links: PROTOCOL.md → /protocol/, HTTP.md → /protocol/http/, section anchors kept. */
const specPath = {
  "PROTOCOL.md": "/protocol/",
  "HTTP.md": "/protocol/http/",
  "PRIVACY.md": "/protocol/privacy/",
  "CONTROL.md": "/protocol/control/",
  "ADAPTERS.md": "/protocol/adapters/",
  "VERSIONING.md": "/protocol/versioning/",
  LICENSE: "/legal/#spec-license",
};
const rootPath = {
  LICENSE: "/legal/",
  NOTICE: "https://github.com/spacesheep-dev/sessionpipe/blob/main/NOTICE",
  DCO: "https://github.com/spacesheep-dev/sessionpipe/blob/main/DCO",
  "CONTRIBUTING.md": "https://github.com/spacesheep-dev/sessionpipe/blob/main/CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md": "https://github.com/spacesheep-dev/sessionpipe/blob/main/CODE_OF_CONDUCT.md",
  "SECURITY.md": "/security/",
  "GOVERNANCE.md": "/governance/",
  "TRADEMARKS.md": "/legal/#trademarks",
  "ROADMAP.md": "https://github.com/spacesheep-dev/sessionpipe/blob/main/ROADMAP.md",
  "CHANGELOG.md": "/changelog/",
  "SUPPORT.md": "https://github.com/spacesheep-dev/sessionpipe/blob/main/SUPPORT.md",
};

function rewriteLinks(md, map, dirPrefix) {
  return md.replace(/\]\(([^)\s]+)\)/g, (m, href) => {
    if (/^(https?:|#|mailto:)/.test(href)) return m;
    const [file, hash] = href.split("#");
    const base = file.replace(/^\.\.\//, "").replace(new RegExp(`^${dirPrefix}`), "");
    const target = map[base];
    if (!target) return m;
    return `](${target}${hash ? `#${hash}` : ""})`;
  });
}

marked.use({ gfm: true, headerIds: true, mangle: false });

function page({ title, description, body, pathname, edit, license, jsonld }) {
  const canonical = SITE + pathname;
  const navHtml = nav
    .map(
      ([href, label]) =>
        `<a href="${href}"${href === pathname || (href !== "/" && pathname.startsWith(href)) ? ' aria-current="page"' : ""}>${label}</a>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#3b3fd8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1220" media="(prefers-color-scheme: dark)">
<link rel="alternate" type="text/plain" href="/llms.txt" title="llms.txt">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
<style>${css}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><a class="brand" href="/" aria-label="sessionpipe home"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h5l2-5 4 10 2-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>sessionpipe</a><nav aria-label="Site">${navHtml}</nav></header>
<main id="main">${body}</main>
<footer><p>${license === "spec" ? 'This page is part of the sessionpipe protocol specification, licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.' : "Code is Apache-2.0; the specification is CC BY 4.0."} ${edit ? `<a href="${edit}">Edit on GitHub</a> ·` : ""} <a href="/security/">Security</a> · <a href="/legal/">Legal &amp; privacy</a> · <a href="/governance/">Governance</a> · <a href="/changelog/">Changelog</a></p><p>No cookies, no analytics, nothing loaded from anyone else. Hosted on GitHub Pages. sessionpipe ${version}.</p><p>Started by the people behind <a href="https://spacesheep.dev">spacesheep</a>, and given to the community as an open protocol: Apache-2.0 code, CC BY 4.0 spec, no CLA.</p></footer>
</body>
</html>
`;
}

function write(pathname, html) {
  const dir = path.join(out, pathname);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), html);
}

function mdPage({ pathname, file, title, description, map, dirPrefix = "", license, extra = "" }) {
  const md = rewriteLinks(read(file), map, dirPrefix);
  const body = `<article class="prose">${marked.parse(md)}${extra}</article>`;
  write(
    pathname,
    page({
      title,
      description,
      body,
      pathname,
      edit: `https://github.com/spacesheep-dev/sessionpipe/edit/main/${file}`,
      license,
    }),
  );
}

// --- protocol, from spec/ ---------------------------------------------------------
const specs = [
  [
    "/protocol/",
    "spec/PROTOCOL.md",
    "sessionpipe protocol v1",
    "The envelope, the session block, the event vocabulary and the privacy tiers of the sessionpipe protocol.",
  ],
  [
    "/protocol/http/",
    "spec/HTTP.md",
    "HTTP binding · sessionpipe protocol",
    "Discovery, batches, errors, retry, idempotency, the control long-poll and the native lane.",
  ],
  [
    "/protocol/privacy/",
    "spec/PRIVACY.md",
    "Privacy: tiers and rulesets · sessionpipe protocol",
    "The four tiers in detail, the secrets and PII rulesets, and guidance for receivers.",
  ],
  [
    "/protocol/control/",
    "spec/CONTROL.md",
    "Control: the channel back · sessionpipe protocol",
    "Permission answers, prompts at the next turn boundary, cancel, and acks.",
  ],
  [
    "/protocol/adapters/",
    "spec/ADAPTERS.md",
    "Adapters · sessionpipe protocol",
    "The harness registry and the per-harness mapping from native hooks to protocol events.",
  ],
  [
    "/protocol/versioning/",
    "spec/VERSIONING.md",
    "Versioning · sessionpipe protocol",
    "The protocol integer, capabilities, deprecation and the spec's status.",
  ],
];
const specNav = `<nav class="subnav" aria-label="Protocol"><a href="/protocol/">Protocol</a><a href="/protocol/http/">HTTP</a><a href="/protocol/privacy/">Privacy</a><a href="/protocol/control/">Control</a><a href="/protocol/adapters/">Adapters</a><a href="/protocol/versioning/">Versioning</a><a href="/schema/v1/event.json">Schemas</a></nav>`;
for (const [pathname, file, title, description] of specs) {
  const md = rewriteLinks(read(file), specPath, "");
  const body = `${specNav}<article class="prose">${marked.parse(md)}</article>`;
  const jsonld = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: SITE + pathname,
    license: "https://creativecommons.org/licenses/by/4.0/",
    isPartOf: { "@type": "WebSite", name: "sessionpipe", url: SITE },
    author: { "@type": "Organization", name: "sessionpipe" },
  };
  write(
    pathname,
    page({
      jsonld,
      title,
      description,
      body,
      pathname,
      edit: `https://github.com/spacesheep-dev/sessionpipe/edit/main/${file}`,
      license: "spec",
    }),
  );
}

// --- schemas index ------------------------------------------------------------------
{
  const files = readdirSync(path.join(root, "schemas/v1"))
    .filter((f) => f.endsWith(".json"))
    .sort();
  const body = `${specNav}<article class="prose"><h1>JSON Schemas, v1</h1><p>Generated from the reference implementation's types (<code>packages/core/schema/v1.ts</code>); these URLs are the schemas' <code>$id</code>s. Served as <code>application/json</code>.</p><ul>${files.map((f) => `<li><a href="/schema/v1/${f}">/schema/v1/${f}</a></li>`).join("")}</ul></article>`;
  write(
    "/schema/",
    page({
      title: "Schemas · sessionpipe protocol",
      description: "The JSON Schemas of the sessionpipe protocol, generated from code.",
      body,
      pathname: "/schema/",
      license: "spec",
    }),
  );
}

// --- root documents -----------------------------------------------------------------
mdPage({
  pathname: "/security/",
  file: "SECURITY.md",
  title: "Security · sessionpipe",
  description: "How to report a vulnerability, supported versions, and the threat model.",
  map: rootPath,
});
mdPage({
  pathname: "/governance/",
  file: "GOVERNANCE.md",
  title: "Governance · sessionpipe",
  description: "Maintainers, how decisions are made, how to become a maintainer.",
  map: rootPath,
});
mdPage({
  pathname: "/changelog/",
  file: "CHANGELOG.md",
  title: "Changelog · sessionpipe",
  description: "Protocol-level changes.",
  map: rootPath,
});
{
  const privacy = read("website/src/pages/privacy.md");
  const body = `<article class="prose">${marked.parse(privacy)}<h2 id="trademarks">Trademarks</h2>${marked.parse(read("TRADEMARKS.md").replace(/^# Trademarks\n/, ""))}<h2 id="code-license">Code license</h2><p>Apache License 2.0. <a href="https://github.com/spacesheep-dev/sessionpipe/blob/main/LICENSE">Full text</a> · <a href="https://github.com/spacesheep-dev/sessionpipe/blob/main/NOTICE">NOTICE</a></p><h2 id="spec-license">Specification license</h2><p>Creative Commons Attribution 4.0 International. <a href="https://creativecommons.org/licenses/by/4.0/">Summary</a> · <a href="https://github.com/spacesheep-dev/sessionpipe/blob/main/spec/LICENSE">Full text</a></p></article>`;
  write(
    "/legal/",
    page({
      title: "Legal & privacy · sessionpipe",
      description: "Privacy notice, trademarks, licenses.",
      body,
      pathname: "/legal/",
    }),
  );
}
for (const [pathname, file, title, description] of [
  [
    "/get-started/",
    "website/src/pages/get-started.md",
    "Get started · sessionpipe",
    "Install, add a sink, tail. The receiver in Docker. Send to spacesheep or to a Slack webhook.",
  ],
  [
    "/receivers/",
    "website/src/pages/receivers.md",
    "Receivers · sessionpipe",
    "Who speaks the sessionpipe protocol, and how to list yours.",
  ],
]) {
  const body = `<article class="prose">${marked.parse(rewriteLinks(read(file), { ...specPath, ...rootPath }, "spec/"))}</article>`;
  write(pathname, page({ title, description, body, pathname }));
}

// --- home ---------------------------------------------------------------------------
const FAQ = [
  [
    "What is sessionpipe?",
    "An open protocol, and a small client, that turns the hooks coding agents already fire (Claude Code, Codex, Gemini CLI, Antigravity, Cursor, Copilot CLI and more) into one uniform stream of session events: started, working on a tool, needs you, ended. You choose per destination how much leaves your machine.",
  ],
  [
    "Does it work with Claude Code hooks?",
    "Yes. <code>sessionpipe install</code> writes Claude Code's SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop, Subagent and Compact hooks into every config dir on the machine, and maps them to protocol events. Codex hooks, Gemini CLI hooks and Antigravity hooks work the same way.",
  ],
  [
    "What are the privacy tiers?",
    "Tier 0 is presence (session state, timing, folder, model, title). Tier 1 adds tool names, durations and file paths. Tier 2 adds your prompts and the assistant's text. Tier 3 adds tool input and output. A sink is configured at a tier; the receiver declares its maximum; the lower wins. Secrets are redacted on your machine above tier 0, always.",
  ],
  [
    "Do I need a server?",
    "No. <code>sessionpipe tail</code> follows the local outbox with no sink configured. When you want a receiver, run the reference one on your laptop, point at any HTTPS endpoint that speaks the protocol, or use a hosted receiver such as spacesheep.",
  ],
  [
    "Is there telemetry?",
    "None. The client reports only to the sinks you configure, this website has no analytics or cookies, and the optional version check is a plain read of the npm registry that you can turn off.",
  ],
  [
    "Who maintains it, and under what license?",
    "Michael Makarov, with a written path to more maintainers. Code is Apache-2.0, the specification is CC BY 4.0, contributions are under the Developer Certificate of Origin with no CLA.",
  ],
];
{
  const diagram = (name) => read(`website/src/diagrams/${name}.svg`);
  let home = read("website/src/pages/home.html");
  home = home.replace(/\{\{diagram:([a-z-]+)\}\}/g, (_, n) => diagram(n));
  home = home.replace(
    "{{faq}}",
    `<section class="block" id="faq"><h2>Questions people ask</h2>${FAQ.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</section>`,
  );
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE}/#website`,
        name: "sessionpipe",
        url: SITE,
        description: "An open protocol and client for what your coding agents are doing.",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE}/#app`,
        name: "sessionpipe",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "macOS, Linux, Windows",
        softwareVersion: version,
        license: "https://www.apache.org/licenses/LICENSE-2.0",
        codeRepository: "https://github.com/spacesheep-dev/sessionpipe",
        url: SITE,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        description:
          "Hooks for Claude Code, Codex, Gemini CLI, Antigravity and other coding agents; four privacy tiers; secrets removed on your machine; sends to your server or to none.",
      },
      {
        "@type": "FAQPage",
        mainEntity: FAQ.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") },
        })),
      },
    ],
  };
  write(
    "/",
    page({
      jsonld,
      title: "sessionpipe — an open protocol for what your coding agents are doing",
      description:
        "One install hooks Claude Code, Codex, Gemini CLI, Antigravity and more. Four privacy tiers, secrets removed on your machine, sent to your server or to none.",
      body: home,
      pathname: "/",
    }),
  );
}

// 404
writeFileSync(
  path.join(out, "404.html"),
  page({
    title: "Not found · sessionpipe",
    description: "That page does not exist.",
    body: `<article class="prose"><h1>Not found</h1><p>Nothing lives at this address. Try the <a href="/">home page</a> or the <a href="/protocol/">protocol</a>.</p></article>`,
    pathname: "/404",
  }),
);
// sitemap + robots
const pages = [
  "/",
  ...specs.map((s) => s[0]),
  "/schema/",
  "/get-started/",
  "/receivers/",
  "/security/",
  "/legal/",
  "/governance/",
  "/changelog/",
];
const today = new Date().toISOString().slice(0, 10);
const urlRow = (p) =>
  `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod><priority>${p === "/" ? "1.0" : p.startsWith("/protocol") ? "0.8" : "0.5"}</priority></url>`;
writeFileSync(
  path.join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(urlRow).join("\n")}\n</urlset>\n`,
);
const llms = [
  "# sessionpipe",
  "",
  "> An open protocol and client for what your coding agents are doing: hooks for Claude Code, Codex, Gemini CLI, Antigravity and more; four privacy tiers; secrets removed on the person's machine; events sent to a server of their choosing or to none. Apache-2.0 code, CC BY 4.0 spec.",
  "",
  "## Protocol",
  "",
  ...specs.map(([p, , t]) => `- [${t}](${SITE}${p})`),
  `- [JSON Schemas](${SITE}/schema/)`,
  "",
  "## Use it",
  "",
  `- [Get started](${SITE}/get-started/)`,
  `- [Receivers](${SITE}/receivers/)`,
  "- [Source](https://github.com/spacesheep-dev/sessionpipe)",
  "",
  "## Project",
  "",
  `- [Security](${SITE}/security/)`,
  `- [Governance](${SITE}/governance/)`,
  `- [Legal and privacy](${SITE}/legal/)`,
  "",
];
writeFileSync(path.join(out, "llms.txt"), llms.join("\n"));
writeFileSync(path.join(out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(path.join(out, ".nojekyll"), "");
console.log(`site: ${pages.length} pages + schemas → website/dist`);
