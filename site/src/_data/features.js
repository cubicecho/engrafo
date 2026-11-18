// The landing page's feature rows: a card on the left (icon, title, one line),
// the detail on the right. Every claim here is in the README or AGENTS.md; a
// feature that changes there changes here.
//
// `icon` names an entry in _includes/icon.njk. `link` is optional and points
// into the self-hosting guide when a feature needs setting up.

export default [
  {
    slug: "capture",
    icon: "upload",
    title: "Get everything in",
    blurb: "Drag in a file or a whole folder, or point your scanner at a watched folder.",
    detail:
      "Uploads go straight from the browser to your bucket, each with its own progress bar, and a folder upload keeps its subfolders. A scanner's network share works too: whatever lands in the watched folder is filed and then removed.",
    points: [
      "PDFs, images (JPEG, PNG, WebP, GIF, TIFF), EPUB, Markdown, CSV, HTML and plain text",
      "Upload a file you already have and Engrafo warns you, with a link to the other copy",
      "A crash mid-file is picked up on the next pass: nothing is filed twice or lost",
    ],
    link: { href: "/self-hosting/#watched-folder", label: "Set up the watched folder" },
  },
  {
    slug: "read",
    icon: "scan",
    title: "Every page read",
    blurb: "OCR turns scans into searchable PDF/A, and a vision model can read them too.",
    detail:
      "ocrmypdf turns pages upright, straightens them and gives them a text layer. A PDF that already has text keeps it. If you have a vision model, any OpenAI-compatible endpoint can re-read the pages instead, as plain text or Markdown with tables.",
    points: [
      "Ebooks are read chapter by chapter, with each chapter named from the table of contents",
      "Text files are read in whatever encoding they were saved in",
      "Vision reads show their progress page by page, and a model that is down never fails an automatic scan",
    ],
  },
  {
    slug: "search",
    icon: "search",
    title: "Search by meaning and by word",
    blurb: "Find a document by what it says, even when you don't remember the words.",
    detail:
      "Every document's text is cut into passages and searched two ways at once: by meaning, with a small embedding model running on your own CPU, and by exact words, with Postgres full-text search. Results show the passage that matched.",
    points: [
      "Narrow a search to a folder, a kind of file, a range of dates, or receipts only",
      "Save a search under a name and open it from the sidebar",
      "The model ships in the image (about 50 MB) and needs no GPU or cloud service",
    ],
  },
  {
    slug: "folders",
    icon: "folder",
    title: "Folders, not tags",
    blurb: "Nested folders, drawn as a tree in the sidebar on every page.",
    detail:
      "File documents the way you file anything else. Drag a document or a folder onto another one, or use Move to. Names are unique within a folder, so a second scan.pdf becomes scan (2) instead of overwriting the first.",
    points: [
      "Deleting puts things in the Trash, and you can restore them for 30 days",
      "Trashed documents are out of search and the tree until you restore them",
    ],
  },
  {
    slug: "receipts",
    icon: "receipt",
    title: "Dates and receipts, filled in",
    blurb: "The date on a letter and the total on a receipt are read for you.",
    detail:
      "The date printed on a document is read from its text in the common formats, in English and German. A receipt's vendor, total and currency are read by plain rules, and left empty when they are unclear rather than guessed. Correct anything you like: your edits are never overwritten.",
    points: [
      "Export receipts as a CSV for a date range or a folder, ready for a spreadsheet",
      "Totals are stored as exact decimals, never rounded floats",
    ],
  },
  {
    slug: "merge",
    icon: "merge",
    title: "Put split scans back together",
    blurb: "Merge pages scanned as separate files, or let Engrafo suggest which belong together.",
    detail:
      "Pick PDFs and images in any order and merge them into one document. The OCR text layer comes along, so nothing is read twice. Engrafo also spots a scan filed as several documents, such as a page per file or front and back apart, and suggests the merge. A vision model can double-check the cases it is unsure of.",
    points: [
      "Suggestions explain themselves, with the reasons for and against",
      "A vision model can suggest a title for the merged copy",
      "Keep the originals, or send them to the Trash, where they can still be restored",
    ],
  },
  {
    slug: "agents",
    icon: "bot",
    title: "Share a folder with your AI agent",
    blurb: "Claude, or any MCP client, can search and read the folders you choose.",
    detail:
      "Share a folder from its menu, make an API key in Settings, and point an MCP client at your instance. It can list, search and read what is in that folder and the folders inside it. Nothing else is visible, and the tools only read.",
    points: [
      "Turning a folder off takes effect on the agent's next call",
      "Works with Claude Code, Claude Desktop, and any other MCP client",
    ],
    link: { href: "/self-hosting/#mcp", label: "Connect an agent" },
  },
  {
    slug: "pipeline",
    icon: "activity",
    title: "A pipeline you can watch",
    blurb: "Every step of every document has a status, and a failure tells you why.",
    detail:
      "The Processing page shows what is running, what is waiting and what has failed. A failed document says which step stopped and offers a retry, and any document can be processed again with OCR turned on or off. A restart picks up where it left off.",
    points: [
      "Long jobs show their progress, such as page 3 of 12",
      "CPU-heavy OCR is limited to a few documents at a time, so a big folder doesn't stall the server",
    ],
  },
  {
    slug: "yours",
    icon: "server",
    title: "Yours, end to end",
    blurb: "Your bucket, your database, your server. Nothing leaves it.",
    detail:
      "Files live in any S3-compatible bucket (RustFS comes in the compose file), metadata in Postgres, and search runs locally. Export the whole archive as a single file and import it into another instance. Sign in with a magic link or your own OpenID Connect provider.",
    points: [
      "Full export and import: originals, folders, dates and receipts",
      "Single sign-on with any OIDC provider, set up from the app",
      "MIT licensed and free",
    ],
    link: { href: "/self-hosting/#backups", label: "Backups and restore" },
  },
];
