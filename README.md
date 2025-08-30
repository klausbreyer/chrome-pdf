# Chrome PDF

Automated PDF generation from Hugo sites using Puppeteer. Crawls your Hugo site and generates a combined PDF with configurable chunking and concurrency.

## Hugo Synergies

- **Local Development**: Generate PDFs from `localhost:1313` during Hugo development
- **Static Site Integration**: Perfect for Hugo sites that need printable versions
- **Content Aggregation**: Combines multiple Hugo pages into single PDFs

## Usage

```bash
# Basic usage (Hugo dev server)
make start

# Custom parameters
node automation.mjs "http://localhost:1313" -o "output.pdf" -k 20 -c 5

# Options
-k, --chunk        Pages per chunk (default: 10)
-c, --concurrency  Parallel workers (default: 3)
-o, --out          Output file path
-t, --timeout      Timeout in ms (default: 10000)
```

## Install

```bash
npm install
```

## Dependencies

- Puppeteer (Chrome automation)
- pdf-lib (PDF manipulation)
- Node.js ≥18
