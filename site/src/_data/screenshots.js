// The hero carousel, in order. Files are in src/assets/screenshots/, captured
// at 1440×900 (2x) from the app's Storybook stories, so the data is mock data,
// never a real archive. `dark` is optional: with it, a reader in dark mode sees
// the dark capture. Width and height are the files' own, so nothing jumps as
// they load.

export default [
  {
    light: "search-light.webp",
    dark: "search-dark.webp",
    width: 2880,
    height: 1120,
    caption: "Search finds the lease by what it says, narrowed to PDFs and receipts.",
    alt: "The Documents page searching for “rent”, filtered to PDFs and receipts only. The lease agreement is found by a passage in its text about the tenant paying 950 EUR a month.",
  },
  {
    light: "document-light.webp",
    dark: "document-dark.webp",
    width: 2880,
    height: 1242,
    caption: "A scanned bill being read: page 3 of 12, with the receipt and details beside it.",
    alt: "A document's page while it is processed: inspect and OCR are done, the vision model is on page 3 of 12, and the search index is queued. Receipt and Details cards sit beside the timeline.",
  },
  {
    light: "merge-suggestions-light.webp",
    dark: "merge-suggestions-dark.webp",
    width: 2880,
    height: 1800,
    caption: "A scan filed as three pages, spotted and explained before you merge it.",
    alt: "The Suggested merges page. Three scans, scan_0004 to scan_0006, are suggested as one document with high confidence (93%), with the reasons for and against listed and Dismiss and Review merge buttons.",
  },
  {
    light: "processing-light.webp",
    dark: "processing-dark.webp",
    width: 2880,
    height: 1120,
    caption: "The Processing page: what is running, queued, failed and finished.",
    alt: "The Processing page with counts of running, queued, failed and finished documents, and a running document showing its page progress.",
  },
  {
    light: "settings-mcp-light.webp",
    dark: "settings-mcp-dark.webp",
    width: 2880,
    height: 1120,
    caption: "Share folders with Claude or any MCP client through one endpoint and an API key.",
    alt: "The MCP settings: the endpoint address, http://nas.local:3004/mcp, one API key named “Claude Code on my laptop” with a Revoke button, and a New key button.",
  },
  {
    light: "settings-vision-light.webp",
    dark: "settings-vision-dark.webp",
    width: 2880,
    height: 1800,
    caption: "Point Engrafo at any OpenAI-compatible vision model, local or hosted.",
    alt: "The vision model settings, connected to a local Ollama server with the qwen2.5vl:7b model and set to read documents automatically.",
  },
];
