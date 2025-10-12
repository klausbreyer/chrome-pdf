// automation.mjs
// Node ≥18, ESM
// Start: node automation.mjs "http://localhost:1313" -o "$HOME/Downloads/combined.pdf" -k 10 -c 3

import fs from "fs";
import os from "os";
import path from "path";
import {PDFDocument} from "pdf-lib";
import puppeteer from "puppeteer";
import {fileURLToPath} from "url";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const argv = yargs(hideBin(process.argv))
  .usage("automation.mjs <url> [options]")
  .positional("url", {
    type: "string",
    demandOption: true,
    describe: "Zu druckende URL (z. B. http://localhost:1313)",
  })
  .option("out", {
    alias: "o",
    type: "string",
    default: path.join(os.homedir(), "Downloads", "combined.pdf"),
    describe: "Zieldatei",
  })
  .option("chunk", {
    alias: "k",
    type: "number",
    default: 10,
    describe: "Seiten pro Chunk",
  })
  .option("concurrency", {
    alias: "c",
    type: "number",
    default: 3,
    describe: "Parallele Worker",
  })
  .option("timeout", {
    alias: "t",
    type: "number",
    default: 10000,
    describe: "Timeout in ms (Health/Goto)",
  })
  .option("headless", {
    type: "boolean",
    default: true,
    describe: "Headless Chrome",
  })
  .option("cssPrint", {
    type: "boolean",
    default: true,
    describe: "CSS @media print erzwingen",
  })
  .option("waitUntil", {
    type: "string",
    default: "load",
    describe:
      "Puppeteer waitUntil (load|domcontentloaded|networkidle0|networkidle2)",
  })
  .option("tmpPrefix", {
    type: "string",
    default: "pup-pdf-",
    describe: "Prefix Temp-Ordner",
  })
  .option("chrome", {
    type: "string",
    default: process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH,
    describe: "Pfad zu Chrome/Chromium",
  })
  .option("healthPath", {
    type: "string",
    default: "/",
    describe: "Pfad für Health-Check (z. B. /index.html)",
  })
  .option("verbose", {
    type: "boolean",
    default: true,
    describe: "Ausführliches Logging",
  })
  .help()
  .parseSync();

const URL = argv._[0] ?? "";
const OUT = argv.out;
const CHUNK = Math.max(1, argv.chunk);
const CONC = Math.max(1, argv.concurrency);

const log = (...a) => {
  if (argv.verbose) console.log("[pdf]", ...a);
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureDir(p) {
  await fs.promises.mkdir(p, {recursive: true}).catch(() => {});
}

function joinUrl(base, rel) {
  try {
    const u = new URL(base);
    return new URL(rel, u).toString();
  } catch {
    return base + rel;
  }
}

// Health-Check: HEAD → GET → /index.html → base
async function waitForHttpOk(
  baseUrl,
  pathHint,
  timeoutMs = 60000,
  intervalMs = 300
) {
  const start = Date.now();
  let lastErr = null;
  const targets = [
    {method: "HEAD", url: joinUrl(baseUrl, pathHint)},
    {method: "GET", url: joinUrl(baseUrl, pathHint)},
    {method: "GET", url: joinUrl(baseUrl, "/index.html")},
    {method: "GET", url: baseUrl},
  ];
  log(`Health-Check auf ${baseUrl} (Timeout ${timeoutMs}ms) ...`);
  while (Date.now() - start < timeoutMs) {
    for (const t of targets) {
      try {
        const res = await fetch(t.url, {method: t.method});
        if (res.status >= 200 && res.status < 500) {
          log(`Health-Check OK: ${t.method} ${t.url} → ${res.status}`);
          return;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    await delay(intervalMs);
  }
  const msg = lastErr && lastErr.message ? lastErr.message : String(lastErr);
  throw new Error(
    `Server nicht erreichbar: ${baseUrl} nach ${timeoutMs}ms. Letzter Fehler: ${msg}`
  );
}

async function launchBrowser() {
  const opts = {headless: argv.headless, args: ["--disable-gpu"]};
  if (argv.chrome) opts.executablePath = argv.chrome;
  log("Starte Browser ...");
  return puppeteer.launch(opts);
}

function isRangeExceedsError(err) {
  return (
    err &&
    typeof err.message === "string" &&
    /Page range exceeds page count/i.test(err.message)
  );
}
async function openPreparedPage(browser) {
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(argv.timeout);
  log(`Lade Seite: ${URL} (waitUntil=${argv.waitUntil}) ...`);
  await page.goto(URL, {waitUntil: argv.waitUntil, timeout: argv.timeout});
  if (argv.cssPrint) {
    await page.emulateMediaType("print");
    await page.addStyleTag({
      content: `*{animation:none!important;transition:none!important}`,
    });
  }
  return page;
}

async function renderRangeToBuffer(page, start, end) {
  log(`→ PDF ${start}-${end}`);
  const buf = await page.pdf({
    printBackground: true,
    preferCSSPageSize: true,
    pageRanges: `${start}-${end}`,
  });
  return Buffer.from(buf);
}

async function countPages(buf) {
  try {
    const doc = await PDFDocument.load(buf);
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

async function mergePdfs(inFiles, outFile) {
  log(`Merge ${inFiles.length} Dateien → ${outFile}`);
  const merged = await PDFDocument.create();
  for (const f of inFiles) {
    const bytes = await fs.promises.readFile(f);
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  const outBytes = await merged.save();
  await fs.promises.writeFile(outFile, outBytes);
}

async function main() {
  const tmpRoot = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), argv.tmpPrefix)
  );
  const tmpDir = path.join(tmpRoot, Date.now().toString());
  await ensureDir(tmpDir);

  await waitForHttpOk(URL, argv.healthPath, argv.timeout ?? 120000, 300);

  const browser = await launchBrowser();

  let nextStart = 1;
  let stopAt = null;
  const results = [];
  let errorOccurred = null;

  const getNextStart = () => {
    if (stopAt !== null && nextStart > stopAt) return null;
    const start = nextStart;
    nextStart += CHUNK;
    return start;
  };

  async function worker(id) {
    log(`Worker ${id} gestartet`);
    const page = await openPreparedPage(browser);
    try {
      while (true) {
        const start = getNextStart();
        if (start === null) break;

        // Falls inzwischen ein globales Ende bekannt ist, vor dem Render abbrechen
        const plannedEnd =
          stopAt !== null
            ? Math.min(stopAt, start + CHUNK - 1)
            : start + CHUNK - 1;
        if (stopAt !== null && start > stopAt) {
          log(`Worker ${id}: start ${start} > stopAt ${stopAt} → Ende`);
          break;
        }

        let buf;
        try {
          buf = await renderRangeToBuffer(page, start, plannedEnd);
        } catch (e) {
          if (isRangeExceedsError(e)) {
            // Ein anderer Worker hat bereits das Ende gefunden → sauber stoppen
            stopAt = stopAt ?? start - 1;
            log(
              `Worker ${id}: Page range exceeds page count bei ${start}-${plannedEnd} → stopAt=${stopAt}`
            );
            break;
          }
          // anderer Fehler → nach außen melden, aber erst nach Promise.all ausgewertet
          errorOccurred = e;
          break;
        }

        const pages = await countPages(buf);

        if (pages === 0) {
          stopAt = stopAt ?? start - 1;
          log(
            `Worker ${id}: 0 Seiten im Bereich ${start}-${plannedEnd} → stopAt=${stopAt}`
          );
          break;
        }

        const fileName = `chunk-${String(start).padStart(5, "0")}-${String(
          plannedEnd
        ).padStart(5, "0")}.pdf`;
        const filePath = path.join(tmpDir, fileName);
        await fs.promises.writeFile(filePath, buf);
        results.push({start, end: plannedEnd, pages, filePath});
        log(`Worker ${id}: geschrieben ${fileName} (Seiten ${pages})`);

        // Weniger Seiten als angefragt → letztes Stück
        const requested = plannedEnd - start + 1;
        if (pages < requested) {
          stopAt = start + pages - 1;
          log(`Worker ${id}: letzter Block erkannt → stopAt=${stopAt}`);
          break;
        }
      }
    } finally {
      await page.close().catch(() => {});
      log(`Worker ${id} fertig`);
    }
  }
  await Promise.all(Array.from({length: CONC}, (_, i) => worker(i + 1)));

  await browser.close().catch(() => {});

  if (errorOccurred) {
    const msg =
      errorOccurred && errorOccurred.message
        ? errorOccurred.message
        : String(errorOccurred);
    console.error("Fehler beim Rendern:", msg);
    process.exit(1);
  }

  if (results.length === 0) {
    console.error("Keine Seiten erzeugt. Prüfe URL/Print-CSS.");
    try {
      await fs.promises.rm(tmpRoot, {recursive: true, force: true});
    } catch {}
    process.exit(2);
  }

  results.sort((a, b) => a.start - b.start);
  const files = results.map((r) => r.filePath);
  await ensureDir(path.dirname(OUT));

  await mergePdfs(files, OUT);

  try {
    await fs.promises.rm(tmpRoot, {recursive: true, force: true});
  } catch {}

  const first = results[0].start;
  const lastBlock = results[results.length - 1];
  const last = lastBlock.start + lastBlock.pages - 1;
  const totalPages = results.reduce((sum, r) => sum + r.pages, 0);

  console.log(`Fertig: ${OUT}`);
  console.log(
    `Seiten: ${totalPages} (Bereich ${first}–${last}), Chunks: ${results.length}, Parallel: ${CONC}`
  );
}

main().catch((err) => {
  const msg =
    err && (err.stack || err.message) ? err.stack || err.message : String(err);
  console.error(msg);
  process.exit(1);
});
