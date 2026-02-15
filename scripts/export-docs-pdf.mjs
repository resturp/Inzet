import { execFileSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
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

const MARKDOWN_CSS = `
  body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #24292f;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  .markdown-body {
    box-sizing: border-box;
    max-width: 860px;
    margin: 0 auto;
    padding: 42px 52px;
    line-height: 1.6;
    font-size: 14px;
  }
  .markdown-body h1,
  .markdown-body h2,
  .markdown-body h3 {
    line-height: 1.25;
    margin-top: 1.8em;
    margin-bottom: 0.6em;
  }
  .markdown-body h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  .markdown-body h3 { font-size: 1.25em; }
  .markdown-body p { margin: 0.6em 0; }
  .markdown-body ul, .markdown-body ol { margin: 0.6em 0 0.9em 1.4em; }
  .markdown-body li { margin: 0.2em 0; }
  .markdown-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 85%;
    padding: 0.2em 0.4em;
    border-radius: 6px;
    background: rgba(175,184,193,0.2);
  }
  .markdown-body pre {
    padding: 12px;
    border-radius: 6px;
    overflow: auto;
    background: #f6f8fa;
  }
  .markdown-body pre code {
    padding: 0;
    background: transparent;
  }
  .markdown-body table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
  }
  .markdown-body table th,
  .markdown-body table td {
    border: 1px solid #d0d7de;
    padding: 6px 10px;
    text-align: left;
  }
  .markdown-body blockquote {
    margin: 0.8em 0;
    padding: 0 1em;
    color: #57606a;
    border-left: 0.25em solid #d0d7de;
  }
  .meta {
    color: #57606a;
    font-size: 12px;
    margin-bottom: 1.5em;
  }
  @page {
    size: A4;
    margin: 12mm;
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

async function markdownToHtmlFile(mdPath, htmlPath, title) {
  const markdown = await readFile(mdPath, "utf-8");
  const content = marked.parse(markdown, {
    gfm: true,
    breaks: false
  });
  const html = `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${MARKDOWN_CSS}</style>
  </head>
  <body>
    <article class="markdown-body">
      <div class="meta">Gegenereerd op ${new Date().toLocaleString("nl-NL")}</div>
      ${content}
    </article>
  </body>
</html>`;
  await writeFile(htmlPath, html, "utf-8");
}

async function htmlToPdf(chromeBinary, htmlPath, pdfPath) {
  execFileSync(
    chromeBinary,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--print-to-pdf-no-header",
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ],
    { stdio: "ignore" }
  );
}

async function main() {
  const chromeBinary = getChromeBinary();

  const reqMd = path.join(docsDir, "requirements-vrijwilligersportaal-vczwolle.md");
  const phaseMd = path.join(docsDir, "fase1-mvp-uitwerking.md");
  const bundleMd = path.join(docsDir, "vczwolle-documentatiebundel.md");

  const reqPdf = path.join(docsDir, "requirements-vrijwilligersportaal-vczwolle.pdf");
  const phasePdf = path.join(docsDir, "fase1-mvp-uitwerking.pdf");
  const bundlePdf = path.join(docsDir, "vczwolle-documentatiebundel.pdf");

  const reqHtml = path.join(docsDir, ".requirements-export.html");
  const phaseHtml = path.join(docsDir, ".fase1-export.html");
  const bundleHtml = path.join(docsDir, ".bundle-export.html");

  const [reqContent, phaseContent] = await Promise.all([
    readFile(reqMd, "utf-8"),
    readFile(phaseMd, "utf-8")
  ]);

  const bundleContent = [
    "# VC Zwolle Vrijwilligersportaal - Documentatiebundel",
    "",
    "## 1. Requirements",
    "",
    reqContent,
    "",
    "---",
    "",
    "## 2. Fase 1 Uitwerking",
    "",
    phaseContent
  ].join("\n");
  await writeFile(bundleMd, bundleContent, "utf-8");

  await markdownToHtmlFile(reqMd, reqHtml, "Requirements VC Zwolle");
  await markdownToHtmlFile(phaseMd, phaseHtml, "Fase 1 Uitwerking VC Zwolle");
  await markdownToHtmlFile(bundleMd, bundleHtml, "VC Zwolle Documentatiebundel");

  await htmlToPdf(chromeBinary, reqHtml, reqPdf);
  await htmlToPdf(chromeBinary, phaseHtml, phasePdf);
  await htmlToPdf(chromeBinary, bundleHtml, bundlePdf);

  await Promise.all([
    unlink(reqHtml).catch(() => undefined),
    unlink(phaseHtml).catch(() => undefined),
    unlink(bundleHtml).catch(() => undefined)
  ]);

  console.log("PDF export klaar:");
  console.log(reqPdf);
  console.log(phasePdf);
  console.log(bundlePdf);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
