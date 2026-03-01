import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const docsDir = path.join(rootDir, "docs");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
];

const BASE_CSS = `
  :root {
    --text: #0f172a;
    --muted: #475569;
    --line: #dbe3ee;
    --accent: #1d4ed8;
    --accent-soft: #e8f0ff;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: var(--text);
    font-family: "Inter", "Segoe UI", Arial, sans-serif;
    line-height: 1.5;
    font-size: 12pt;
  }

  .page {
    width: 100%;
  }

  .cover {
    min-height: 257mm;
    padding: 26mm 20mm 16mm 20mm;
    background:
      radial-gradient(circle at 0% 0%, #e9f1ff 0%, #ffffff 45%),
      radial-gradient(circle at 100% 100%, #f2f7ff 0%, #ffffff 60%);
    display: grid;
    grid-template-rows: auto 1fr auto;
    page-break-after: always;
  }

  .cover-badge {
    display: inline-block;
    border: 1px solid #c6d9ff;
    background: #ffffffcc;
    color: #1e3a8a;
    border-radius: 999px;
    font-size: 10pt;
    padding: 4px 10px;
    width: fit-content;
  }

  .cover h1 {
    margin: 18mm 0 4mm 0;
    font-size: 30pt;
    line-height: 1.12;
    letter-spacing: 0.01em;
  }

  .cover h2 {
    margin: 0;
    color: #1e3a8a;
    font-weight: 600;
    font-size: 15pt;
  }

  .cover-meta {
    margin-top: 16mm;
    color: var(--muted);
    font-size: 10pt;
  }

  .toc {
    padding: 16mm 20mm 14mm 20mm;
    page-break-after: always;
  }

  .toc h2 {
    margin: 0 0 8mm 0;
    font-size: 18pt;
    border-bottom: 1px solid var(--line);
    padding-bottom: 3mm;
  }

  .toc-list {
    display: grid;
    gap: 2mm;
  }

  .toc-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text);
    text-decoration: none;
    border-radius: 6px;
    padding: 1px 2px;
  }

  .toc-item:hover {
    background: var(--accent-soft);
  }

  .toc-item .label {
    text-decoration: none;
  }

  .toc-item.depth-2 { padding-left: 0; font-weight: 600; }
  .toc-item.depth-3 { padding-left: 6mm; font-weight: 500; }
  .toc-item.depth-4 { padding-left: 12mm; color: var(--muted); }

  .content {
    padding: 8mm 20mm 14mm 20mm;
  }

  .doc-section {
    page-break-before: always;
  }

  .doc-section:first-child {
    page-break-before: auto;
  }

  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3,
  .markdown-body h4 {
    line-height: 1.25;
  }

  .markdown-body h1 {
    margin: 0 0 4mm 0;
    font-size: 22pt;
    border-bottom: 1px solid var(--line);
    padding-bottom: 2.2mm;
  }

  .markdown-body h2 {
    margin: 7mm 0 3mm 0;
    font-size: 15.5pt;
    border-bottom: 1px solid var(--line);
    padding-bottom: 1.5mm;
  }

  .markdown-body h3 {
    margin: 6mm 0 2.5mm 0;
    font-size: 13pt;
  }

  .markdown-body h4 {
    margin: 5mm 0 2mm 0;
    font-size: 11.5pt;
  }

  .markdown-body p {
    margin: 2.2mm 0;
  }

  .markdown-body ul,
  .markdown-body ol {
    margin: 2.2mm 0 3.2mm 5.5mm;
    padding-left: 4mm;
  }

  .markdown-body li {
    margin: 1mm 0;
  }

  .markdown-body a {
    color: var(--accent);
    text-decoration: none;
  }

  .markdown-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 85%;
    padding: 0.1em 0.35em;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.07);
  }

  .markdown-body pre {
    padding: 3mm;
    border-radius: 8px;
    overflow: auto;
    background: #f8fafc;
    border: 1px solid #e5edf8;
  }

  .markdown-body pre code {
    padding: 0;
    background: transparent;
  }

  .markdown-body table {
    border-collapse: collapse;
    width: 100%;
    margin: 3.5mm 0;
    font-size: 10.5pt;
  }

  .markdown-body table th,
  .markdown-body table td {
    border: 1px solid #d3deeb;
    padding: 1.7mm 2mm;
    text-align: left;
    vertical-align: top;
  }

  .markdown-body blockquote {
    margin: 3mm 0;
    padding: 1mm 3mm;
    color: #334155;
    border-left: 2.5px solid #bfd3f5;
    background: #f8fbff;
  }

  @page {
    size: A4;
    margin: 16mm 12mm 16mm 12mm;
  }
`;

function getChromeBinary() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error("Geen ondersteunde Chrome/Brave binary gevonden voor PDF-export.");
}

function stripHtmlTags(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function slugify(text) {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function annotateHeadings(html, idPrefix = "") {
  const headingPattern = /<h([1-6])>([\s\S]*?)<\/h\1>/g;
  const used = new Map();
  const headings = [];
  let match;
  let cursor = 0;
  let nextHtml = "";

  while ((match = headingPattern.exec(html)) !== null) {
    const [fullMatch, depthRaw, inner] = match;
    const depth = Number(depthRaw);
    const plain = stripHtmlTags(inner);
    const base = slugify(plain) || "heading";
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    const unique = count > 1 ? `${base}-${count}` : base;
    const id = idPrefix ? `${idPrefix}-${unique}` : unique;
    const start = match.index;
    const end = start + fullMatch.length;
    nextHtml += html.slice(cursor, start);
    nextHtml += `<h${depth} id="${id}">${inner}</h${depth}>`;
    cursor = end;
    headings.push({ depth, text: plain, id });
  }

  nextHtml += html.slice(cursor);
  return { html: nextHtml, headings };
}

function buildTocHtml(headings) {
  const filtered = headings.filter((item) => item.depth >= 2 && item.depth <= 4);
  if (filtered.length === 0) {
    return `<p>Geen inhoudsopgave beschikbaar.</p>`;
  }
  return `
    <div class="toc-list">
      ${filtered
        .map(
          (item) => `
        <a class="toc-item depth-${item.depth}" href="#${item.id}">
          <span class="label">${item.text}</span>
        </a>
      `
        )
        .join("\n")}
    </div>
  `;
}

function stripLeadingH1(markdown) {
  return markdown.replace(/^# .+\n+/, "").trim();
}

function renderMarkdownSection(markdown, sectionPrefix = "") {
  const parsed = marked.parse(markdown, {
    gfm: true,
    breaks: false
  });
  const html = typeof parsed === "string" ? parsed : String(parsed);
  return annotateHeadings(html, sectionPrefix);
}

function buildHtmlDocument(params) {
  const { title, subtitle, headingDateLabel, tocHtml, contentHtml } = params;
  return `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${BASE_CSS}</style>
  </head>
  <body>
    <main class="page">
      <section class="cover">
        <div class="cover-badge">VC Zwolle - Inzet</div>
        <div>
          <h1>${title}</h1>
          ${subtitle ? `<h2>${subtitle}</h2>` : ""}
          <p class="cover-meta">${headingDateLabel}</p>
        </div>
        <div class="cover-meta">Gegenereerd op ${new Date().toLocaleString("nl-NL")}</div>
      </section>

      <section class="toc">
        <h2>Inhoudsopgave</h2>
        ${tocHtml}
      </section>

      <section class="content markdown-body">
        ${contentHtml}
      </section>
    </main>
  </body>
</html>`;
}

function waitForDevToolsWsUrl(processRef, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let buffer = "";

    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match?.[1]) {
        cleanup();
        resolve(match[1]);
      } else if (Date.now() - start > timeoutMs) {
        cleanup();
        reject(new Error("Timeout: geen DevTools websocket URL ontvangen van Chrome."));
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Chrome stopte onverwacht (exit ${code ?? "onbekend"}).`));
    };

    const cleanup = () => {
      processRef.stdout.off("data", onData);
      processRef.stderr.off("data", onData);
      processRef.off("exit", onExit);
    };

    processRef.stdout.on("data", onData);
    processRef.stderr.on("data", onData);
    processRef.on("exit", onExit);
  });
}

function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const eventListeners = new Set();
  let messageId = 0;

  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data.toString());
        if (payload.id) {
          const waiter = pending.get(payload.id);
          if (!waiter) {
            return;
          }
          pending.delete(payload.id);
          if (payload.error) {
            waiter.reject(new Error(payload.error.message || "CDP fout"));
            return;
          }
          waiter.resolve(payload.result ?? {});
          return;
        }
        for (const listener of eventListeners) {
          listener(payload);
        }
      };
      ws.onerror = (event) => {
        reject(new Error(`CDP websocket fout: ${event.message ?? "onbekende fout"}`));
      };

      resolve({
        send(method, params = {}, sessionId) {
          const id = ++messageId;
          const request = { id, method, params };
          if (sessionId) {
            request.sessionId = sessionId;
          }
          const responsePromise = new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
          });
          ws.send(JSON.stringify(request));
          return responsePromise;
        },
        onEvent(handler) {
          eventListeners.add(handler);
          return () => eventListeners.delete(handler);
        },
        close() {
          ws.close();
        }
      });
    };

    ws.onerror = (event) => {
      reject(new Error(`Kan geen verbinding maken met DevTools: ${event.message ?? "fout"}`));
    };
  });
}

async function printHtmlToPdfWithCdp(chromeBinary, htmlPath, pdfPath, title) {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "inzet-docs-chrome-"));
  const chrome = spawn(
    chromeBinary,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "about:blank"
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  let wsUrl = "";
  let client = null;
  try {
    wsUrl = await waitForDevToolsWsUrl(chrome);
    client = await createCdpClient(wsUrl);

    const target = await client.send("Target.createTarget", {
      url: "about:blank"
    });

    const attached = await client.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true
    });
    const sessionId = attached.sessionId;

    let loadDone = false;
    const offEvent = client.onEvent((eventPayload) => {
      if (eventPayload.sessionId === sessionId && eventPayload.method === "Page.loadEventFired") {
        loadDone = true;
      }
    });

    await client.send("Page.enable", {}, sessionId);
    await client.send("Page.navigate", { url: pathToFileURL(htmlPath).href }, sessionId);

    const startWait = Date.now();
    while (!loadDone && Date.now() - startWait < 15000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Extra korte rust zodat fonts en layout zeker klaar staan.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const headerTemplate = `
      <div style="width:100%; font-size:8px; color:#64748b; padding:0 10mm; text-align:right;">
        <span>${title}</span>
      </div>
    `;
    const footerTemplate = `
      <div style="width:100%; font-size:8px; color:#64748b; padding:0 10mm; text-align:center;">
        Pagina <span class="pageNumber"></span> van <span class="totalPages"></span>
      </div>
    `;

    const pdfResult = await client.send(
      "Page.printToPDF",
      {
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        preferCSSPageSize: true,
        marginTop: 0.55,
        marginBottom: 0.7,
        marginLeft: 0.35,
        marginRight: 0.35
      },
      sessionId
    );

    offEvent();
    await client.send("Target.closeTarget", { targetId: target.targetId });
    const pdfBuffer = Buffer.from(pdfResult.data, "base64");
    await writeFile(pdfPath, pdfBuffer);
  } finally {
    try {
      client?.close();
    } catch {
      // ignore
    }
    if (!chrome.killed) {
      chrome.kill("SIGTERM");
    }
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeSingleDocHtml(params) {
  const { markdownPath, htmlPath, title, subtitle } = params;
  const markdown = await readFile(markdownPath, "utf-8");
  const section = renderMarkdownSection(markdown, "doc");
  const toc = buildTocHtml(section.headings);
  const html = buildHtmlDocument({
    title,
    subtitle,
    headingDateLabel: `Bron: ${path.basename(markdownPath)}`,
    tocHtml: toc,
    contentHtml: `<article class="doc-section">${section.html}</article>`
  });
  await writeFile(htmlPath, html, "utf-8");
}

async function writeBundleMarkdownAndHtml(params) {
  const { sections, bundleMdPath, bundleHtmlPath, title, subtitle } = params;
  const bundleMd = [];
  const renderedSections = [];
  const bundleHeadings = [];

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const sourceMarkdown = await readFile(section.path, "utf-8");
    const sectionMarkdown = stripLeadingH1(sourceMarkdown);
    bundleMd.push(`# ${section.title}`);
    bundleMd.push("");
    bundleMd.push(sectionMarkdown.trim());
    bundleMd.push("");
    if (i < sections.length - 1) {
      bundleMd.push("---");
      bundleMd.push("");
    }

    const rendered = renderMarkdownSection(sectionMarkdown, `sec${i + 1}`);
    const withTitleAnchor = `<h1 id="section-${i + 1}">${section.title}</h1>\n${rendered.html}`;
    renderedSections.push(`<article class="doc-section">${withTitleAnchor}</article>`);
    bundleHeadings.push({ depth: 2, text: section.title, id: `section-${i + 1}` });
    bundleHeadings.push(...rendered.headings.filter((item) => item.depth >= 2));
  }

  await writeFile(bundleMdPath, bundleMd.join("\n"), "utf-8");

  const bundleHtml = buildHtmlDocument({
    title,
    subtitle,
    headingDateLabel: `Bronnen: ${sections.map((item) => path.basename(item.path)).join(", ")}`,
    tocHtml: buildTocHtml(bundleHeadings),
    contentHtml: renderedSections.join("\n")
  });
  await writeFile(bundleHtmlPath, bundleHtml, "utf-8");
}

async function main() {
  const chromeBinary = getChromeBinary();
  const tempHtmlFiles = [];

  const userGuideMd = path.join(docsDir, "gebruikershandleiding-user-stories.md");
  const systemGuideMd = path.join(docsDir, "handleiding-hele-systeem.md");
  const notificationsMd = path.join(docsDir, "notificaties.txt");
  const requirementsMd = path.join(docsDir, "requirements-vrijwilligersportaal-vczwolle.md");
  const phaseMd = path.join(docsDir, "fase1-mvp-uitwerking.md");
  const bundleMd = path.join(docsDir, "vczwolle-documentatiebundel.md");

  const userGuidePdf = path.join(docsDir, "gebruikershandleiding-user-stories.pdf");
  const systemGuidePdf = path.join(docsDir, "handleiding-hele-systeem.pdf");
  const notificationsPdf = path.join(docsDir, "notificaties.pdf");
  const requirementsPdf = path.join(docsDir, "requirements-vrijwilligersportaal-vczwolle.pdf");
  const phasePdf = path.join(docsDir, "fase1-mvp-uitwerking.pdf");
  const bundlePdf = path.join(docsDir, "vczwolle-documentatiebundel.pdf");

  const userGuideHtml = path.join(docsDir, ".user-guide-export.html");
  const systemGuideHtml = path.join(docsDir, ".system-guide-export.html");
  const notificationsHtml = path.join(docsDir, ".notifications-export.html");
  const requirementsHtml = path.join(docsDir, ".requirements-export.html");
  const phaseHtml = path.join(docsDir, ".phase-export.html");
  const bundleHtml = path.join(docsDir, ".bundle-export.html");
  tempHtmlFiles.push(
    userGuideHtml,
    systemGuideHtml,
    notificationsHtml,
    requirementsHtml,
    phaseHtml,
    bundleHtml
  );

  await writeSingleDocHtml({
    markdownPath: userGuideMd,
    htmlPath: userGuideHtml,
    title: "Gebruikershandleiding Inzet",
    subtitle: "Op basis van user stories"
  });

  await writeSingleDocHtml({
    markdownPath: systemGuideMd,
    htmlPath: systemGuideHtml,
    title: "Handleiding Hele Systeem",
    subtitle: "Techniek, processen en beheer"
  });

  await writeSingleDocHtml({
    markdownPath: notificationsMd,
    htmlPath: notificationsHtml,
    title: "Notificatie-overzicht",
    subtitle: "E-mailtypes en templates"
  });

  await writeSingleDocHtml({
    markdownPath: requirementsMd,
    htmlPath: requirementsHtml,
    title: "Requirementsdocument",
    subtitle: "Vrijwilligersportaal VC Zwolle"
  });

  await writeSingleDocHtml({
    markdownPath: phaseMd,
    htmlPath: phaseHtml,
    title: "Fase 1 Uitwerking",
    subtitle: "MVP Vrijwilligersportaal VC Zwolle"
  });

  await writeBundleMarkdownAndHtml({
    sections: [
      { title: "Handleiding Hele Systeem", path: systemGuideMd },
      { title: "Gebruikershandleiding (User Stories)", path: userGuideMd },
      { title: "Notificatie-overzicht", path: notificationsMd }
    ],
    bundleMdPath: bundleMd,
    bundleHtmlPath: bundleHtml,
    title: "VC Zwolle - Documentatiebundel",
    subtitle: "Actuele systeem- en gebruikersdocumentatie"
  });

  await printHtmlToPdfWithCdp(chromeBinary, userGuideHtml, userGuidePdf, "Gebruikershandleiding Inzet");
  await printHtmlToPdfWithCdp(chromeBinary, systemGuideHtml, systemGuidePdf, "Handleiding Hele Systeem");
  await printHtmlToPdfWithCdp(chromeBinary, notificationsHtml, notificationsPdf, "Notificatie-overzicht");
  await printHtmlToPdfWithCdp(chromeBinary, requirementsHtml, requirementsPdf, "Requirementsdocument");
  await printHtmlToPdfWithCdp(chromeBinary, phaseHtml, phasePdf, "Fase 1 Uitwerking");
  await printHtmlToPdfWithCdp(chromeBinary, bundleHtml, bundlePdf, "VC Zwolle Documentatiebundel");

  await Promise.all(tempHtmlFiles.map((filePath) => rm(filePath, { force: true })));

  console.log("PDF export klaar:");
  console.log(userGuidePdf);
  console.log(systemGuidePdf);
  console.log(notificationsPdf);
  console.log(requirementsPdf);
  console.log(phasePdf);
  console.log(bundlePdf);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
