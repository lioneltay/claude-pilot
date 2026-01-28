# Web Search for AI Agents: A Complete Methodology Guide

This guide explains how web search tools work for AI agents - from searching to parsing to presenting results in an AI-friendly format.

---

## Table of Contents

1. [The Challenge](#the-challenge)
2. [The Pipeline](#the-pipeline)
3. [Step 1: Search](#step-1-search)
4. [Step 2: Fetch](#step-2-fetch)
5. [Step 3: Extract](#step-3-extract)
6. [Step 4: Format](#step-4-format)
7. [Step 5: Present to Model](#step-5-present-to-model)
8. [Real-World Implementations](#real-world-implementations)
9. [Key Challenges](#key-challenges)

---

## The Challenge

You can't just give an AI model a raw web page because:

| Problem | Why It Matters |
|---------|----------------|
| **Token limits** | A single web page can be 50,000+ tokens. Models have context limits. |
| **Noise** | HTML markup, ads, navigation, footers are irrelevant clutter |
| **Cost** | More tokens = more money per API call |
| **Quality** | Models perform better with clean, focused content |
| **Multiple sources** | Need to synthesize info from many pages |

---

## The Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   SEARCH    │───▶│    FETCH    │───▶│   EXTRACT   │───▶│   FORMAT    │───▶│   PRESENT   │
│             │    │             │    │             │    │             │    │             │
│ Query → URLs│    │ URLs → HTML │    │ HTML → Text │    │ Text → Clean│    │ To Model    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## Step 1: Search

**Goal:** Convert a query into a list of relevant URLs

### Search APIs

| Provider | Pros | Cons |
|----------|------|------|
| **Google Custom Search** | Best results, reliable | $5/1000 queries, rate limits |
| **Bing Search API** | Good results, Azure integration | Requires Azure account |
| **SerpAPI** | Easy, multiple engines | $50+/month |
| **Tavily** | Built for AI agents, includes extraction | Newer, less known |
| **DuckDuckGo** | Free | Unofficial API, less reliable |
| **Brave Search** | Privacy-focused, has API | Smaller index |

### What You Get Back

```json
{
  "results": [
    {
      "title": "Claude AI: Latest Updates 2026",
      "url": "https://example.com/claude-updates",
      "snippet": "Anthropic released Claude 4 with improved reasoning..."
    }
  ]
}
```

### Key Decisions

- **How many results?** Usually 5-10. More = more context but more cost
- **Filter by date?** For news queries, limit to recent results
- **Site restrictions?** Sometimes you want results from specific domains

---

## Step 2: Fetch

**Goal:** Download the HTML content from each URL

### Simple Approach

```typescript
const html = await fetch(url).then(r => r.text());
```

### Challenges

| Challenge | Solution |
|-----------|----------|
| **JavaScript-rendered pages** | Use Puppeteer/Playwright for SPAs |
| **Paywalls** | Skip or use archive services |
| **Rate limiting** | Add delays, respect robots.txt |
| **Timeouts** | Set reasonable limits (5-10 seconds) |
| **Bot detection** | Proper User-Agent, headers |

### Parallel Fetching

```typescript
// Fetch multiple pages concurrently
const pages = await Promise.all(
  urls.slice(0, 5).map(url =>
    fetch(url, { timeout: 5000 })
      .then(r => r.text())
      .catch(() => null)  // Don't fail on one bad page
  )
);
```

---

## Step 3: Extract

**Goal:** Convert messy HTML into clean, readable text

This is the **most important step**. Raw HTML is useless to an AI.

### The Problem with Raw HTML

```html
<!DOCTYPE html>
<html>
<head>
  <script>analytics.track(...);</script>
  <style>.nav { display: flex; }</style>
</head>
<body>
  <nav>Home | About | Contact</nav>
  <div class="ad">BUY NOW!</div>
  <article>
    <h1>Actual Article Title</h1>
    <p>This is the content you actually want.</p>
  </article>
  <footer>Copyright 2026</footer>
  <script>moreTracking();</script>
</body>
</html>
```

**What you want:** Just the article title and content.

### Extraction Libraries

| Library | Language | How It Works |
|---------|----------|--------------|
| **Mozilla Readability** | JS | Same algorithm as Firefox Reader View |
| **Trafilatura** | Python | Academic-grade extraction |
| **newspaper3k** | Python | News article focused |
| **Cheerio** | JS | jQuery-like HTML parsing |
| **BeautifulSoup** | Python | General HTML parsing |

### Mozilla Readability Example

```typescript
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

function extractContent(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  return {
    title: article?.title || '',
    content: article?.textContent || '',
    excerpt: article?.excerpt || '',
  };
}
```

### What Readability Does

1. **Removes junk:** Scripts, styles, ads, navigation
2. **Finds main content:** Uses heuristics to identify the article body
3. **Extracts text:** Strips remaining HTML, preserves structure
4. **Handles edge cases:** Lazy-loaded images, infinite scroll, etc.

### Manual Extraction (Cheerio)

For more control:

```typescript
import * as cheerio from 'cheerio';

function extractContent(html: string) {
  const $ = cheerio.load(html);

  // Remove junk
  $('script, style, nav, footer, .ad, .sidebar').remove();

  // Get main content
  const mainContent = $('article, main, .content, .post').first();

  // Extract text
  const text = mainContent.text()
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();

  return text;
}
```

---

## Step 4: Format

**Goal:** Structure the extracted content for optimal AI consumption

### Token Budget

You have limited tokens. Allocate wisely:

```
Total budget: ~4000 tokens for search results

Per result (5 results):
- Title: ~10 tokens
- URL: ~20 tokens
- Content: ~750 tokens
- Metadata: ~10 tokens
─────────────────────
Total per result: ~800 tokens
```

### Truncation Strategies

**Option A: Hard truncate**
```typescript
const content = extractedText.slice(0, 3000);
```

**Option B: Smart truncate (preserve sentences)**
```typescript
function smartTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const truncated = text.slice(0, maxLength);
  const lastSentence = truncated.lastIndexOf('.');

  return lastSentence > maxLength * 0.8
    ? truncated.slice(0, lastSentence + 1)
    : truncated + '...';
}
```

**Option C: Extractive summary (pick key sentences)**
```typescript
// Use TF-IDF or similar to pick most relevant sentences
// More complex but better quality
```

### Structured Format

```typescript
interface FormattedResult {
  title: string;
  url: string;
  snippet: string;      // 1-2 sentence summary
  content: string;      // Main extracted text (truncated)
  publishedDate?: string;
}
```

---

## Step 5: Present to Model

**Goal:** Package results so the AI can effectively use them

### Format Options

**Option A: Plain Text**

```
Web search results for: "Claude AI news 2026"

[1] Claude 4 Released with Enhanced Reasoning
URL: https://example.com/claude-4
Anthropic announced Claude 4 today with significant improvements
to mathematical reasoning and code generation...

[2] Anthropic Raises $5B Series D
URL: https://techcrunch.com/anthropic-funding
The AI safety company has raised another major round...
```

**Option B: JSON**

```json
{
  "query": "Claude AI news 2026",
  "results": [
    {
      "title": "Claude 4 Released",
      "url": "https://...",
      "content": "..."
    }
  ]
}
```

**Option C: Markdown**

```markdown
## Search Results: Claude AI news 2026

### 1. [Claude 4 Released](https://example.com/claude-4)
Anthropic announced Claude 4 today...

### 2. [Anthropic Raises $5B](https://techcrunch.com/...)
The AI safety company has raised...
```

### Adding Instructions

Tell the model how to use the results:

```
Based on the search results below, answer the user's question.
Cite sources using [1], [2], etc.
If the results don't contain enough information, say so.

---
SEARCH RESULTS:
[results here]
---

USER QUESTION: What's new with Claude AI?
```

---

## Real-World Implementations

### How Anthropic Does It (from our analysis)

1. **Separate API call** for web search execution
2. **Server-side search & fetch** - Claude never sees raw HTML
3. **Model generates summary** with citations
4. **`encrypted_content`** hides raw data from API consumers
5. **`cited_text`** provides readable snippets

```
User Request → Model decides to search → Anthropic servers:
  1. Execute Bing search
  2. Fetch pages
  3. Extract content
  4. Feed to model
  5. Model generates summary with citations
→ Return summary + citations to client
```

### How Perplexity Does It

1. Search multiple sources simultaneously
2. Use custom extraction per source type
3. RAG (Retrieval-Augmented Generation) to find relevant chunks
4. Stream answer with inline citations
5. Show sources in sidebar

### How ChatGPT Browse Does It

1. Model decides when to search
2. Bing API for search
3. Fetch and extract with custom pipeline
4. Chunk content and embed
5. Retrieve relevant chunks for model

---

## Key Challenges

### 1. Quality vs. Speed

```
More processing = better quality but slower
├── Just snippets from search API: Fast, low quality
├── Fetch + basic extract: Medium
└── Fetch + Readability + summarize: Slow, high quality
```

### 2. Dynamic Content

Many sites use JavaScript to load content:

```typescript
// Simple fetch won't work
const html = await fetch(url);  // Gets empty shell

// Need browser automation
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle0' });
const html = await page.content();  // Gets full rendered content
```

### 3. Rate Limiting & Costs

| Component | Limit/Cost |
|-----------|------------|
| Search API | $/query, queries/second |
| Fetching | Respect robots.txt, add delays |
| Model tokens | $/token, context limits |

### 4. Content Freshness

- Search results may be outdated
- Cached pages may not reflect current content
- News queries need date filtering

### 5. Source Reliability

- Not all sources are trustworthy
- May need domain allowlists/blocklists
- Consider source reputation in ranking

---

## Practical Implementation Checklist

```
□ Choose search API (based on budget and quality needs)
□ Implement fetching with proper error handling
□ Set up content extraction (Readability recommended)
□ Define token budget and truncation strategy
□ Design result format (plain text vs JSON vs markdown)
□ Add caching to reduce API calls
□ Implement rate limiting
□ Handle JavaScript-rendered pages (if needed)
□ Add source filtering (optional)
□ Test with various query types
```

---

## Summary

Web search for AI agents is a **pipeline problem**, not just an API call:

1. **Search** - Get URLs from a search API
2. **Fetch** - Download HTML (handle JS, timeouts, errors)
3. **Extract** - Convert HTML to clean text (Readability is your friend)
4. **Format** - Truncate and structure for token efficiency
5. **Present** - Package with instructions for the model

The hard part isn't searching - it's **making web content AI-friendly** through extraction and formatting. This is why services like Anthropic handle it server-side rather than exposing raw content to clients.

---

## Further Reading

- [Mozilla Readability](https://github.com/mozilla/readability)
- [Trafilatura Documentation](https://trafilatura.readthedocs.io/)
- [Tavily AI Search](https://tavily.com/) - Built specifically for AI agents
- [LangChain Web Search](https://python.langchain.com/docs/integrations/tools/)
