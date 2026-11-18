// The hero carousel, in order. Files are in src/assets/screenshots/, captured
// at 1440×900 (2x) from the app's `Layouts/AppLayout/Screens` Storybook stories
// (app/src/components/layouts/app-layout.screens.stories.tsx): each page inside
// the real shell, over a sample archive, never a real one. `dark` is optional:
// with it, a reader in dark mode sees the dark capture.

const WIDTH = 2880;
const HEIGHT = 1800;

export default [
  {
    light: "search-light.webp",
    dark: "search-dark.webp",
    caption: "Search finds bills by what they say, each with its first page and the passage that matched.",
    alt: "The Documents page searching for “utility bills”. Five results, two electricity bills, a water bill, a lease and a payslip, each with a thumbnail and the passage that matched. The sidebar shows the folder tree: Home, Utilities, Medical, Receipts (shared over MCP) and Taxes.",
  },
  {
    light: "document-light.webp",
    dark: "document-dark.webp",
    caption: "A bill read by the vision model: its text as Markdown, the vendor and total filled in beside it.",
    alt: "An electricity bill's page on the Text tab, showing the bill transcribed as Markdown with its tables. Beside it, a Receipt card with vendor Stadtwerke München and total €84.20, and a Details card with the date read from the text.",
  },
  {
    light: "merge-suggestions-light.webp",
    dark: "merge-suggestions-dark.webp",
    caption: "A letter scanned a page per file, spotted and explained before you merge it.",
    alt: "The Suggested merges page. Three scans, scan_0004 to scan_0006, are suggested as one document with high confidence (93%), with the reasons for and against, a note that the AI model confirmed one page break, and Dismiss and Review merge buttons.",
  },
  {
    light: "processing-light.webp",
    dark: "processing-dark.webp",
    caption: "A batch going through: one document read page by page, three waiting their turn.",
    alt: "The Processing page: 1 running, 3 queued, 0 failed and 14 finished in the last day. The running document, a tax return, is on page 8 of 18 with the vision model, with a progress bar.",
  },
  {
    light: "settings-mcp-light.webp",
    dark: "settings-mcp-dark.webp",
    caption: "Share a folder with Claude or any MCP client through one endpoint and an API key.",
    alt: "The MCP settings: the endpoint address, http://nas.local:3004/mcp, and two API keys, “Claude Code on my laptop” and “Claude Desktop”, each with a Revoke button. The Receipts folder in the sidebar is marked MCP.",
  },
  {
    light: "settings-vision-light.webp",
    dark: "settings-vision-dark.webp",
    caption: "Point Engrafo at any OpenAI-compatible vision model, local or hosted.",
    alt: "The vision model settings, connected to a local Ollama server with the qwen2.5vl:7b model and set to read documents automatically.",
  },
].map((shot) => ({ ...shot, width: WIDTH, height: HEIGHT }));
