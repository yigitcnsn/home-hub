# KAP ↔ Ollama contract (home-hub)

Aligned with [pi-llm](https://github.com/yigitcnsn/pi-llm) (`CONTRACT.md`, `examples/classify_kap.js`, `prompts/kap_sentiment.txt`).

## Ownership

| Repo | Owns |
|------|------|
| **home-hub** | KAP scrape, compress notes, UI, persist, job queue, calling Ollama |
| **pi-llm** | Ollama install, prompts, hardening, example clients only |

No model runtime / weights in home-hub.

## Deployment

- Home-hub and Ollama may be on the **same Pi** or **different machines**.
- On host **`ev`** (user `ycs`), both repos are siblings:

```text
/home/ycs/home-hub/
/home/ycs/pi-llm/
```

- Same-machine default: `OLLAMA_BASE_URL=http://127.0.0.1:11434` (Ollama **root**, **no `/v1`**).
- Classify call: `POST {OLLAMA_BASE_URL}/v1/chat/completions`
- Prompt file (from home-hub cwd / repo root): `../pi-llm/prompts/kap_sentiment.txt`  
  Override with `KAP_PROMPT_PATH` if needed.

## Env (home-hub)

| Variable | Default | Notes |
|----------|---------|--------|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Root URL only (no `/v1`) |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Configurable; UI picker optional later |
| `KAP_LANGUAGE` | `tr` | v1 scrapes Turkish KAP (`/tr`) |
| `KAP_WATCHLIST` | _(empty)_ | Seed for `data/kap/watchlist.json` (UI can edit after) |
| `KAP_POLL_INTERVAL_MS` | `3600000` (1 hour) | Scheduled scrape |
| `KAP_PROMPT_PATH` | `../pi-llm/prompts/kap_sentiment.txt` | Relative to home-hub on `ev` |

## Module UX

- Module id: `kap`
- Sidebar page + optional Home widget
- **First UI:** watchlist + latest disclosures with sentiment badges
- **Secondary:** paste text → classify (learning / debug)
- Disclaimer: not investment advice
- Show sentiment, confidence, and reason
- On Ollama down / timeout: Logs + UI error banner

## v1 scope

- Watchlist only (not all BIST)
- Language: **`tr`**
- Classify input: **subject/title + KAP özet** (full text optional / on demand)
- Queue: **one-at-a-time**
- Timeout: **up to 300s**
- Job status: `pending` → `running` → `done` | `error`
- Persist classifications (survive restart)

## Ollama model output (only)

```json
{
  "stock": "THYAO",
  "sentiment": "good",
  "confidence": 0.0,
  "summary": "...",
  "reason": "..."
}
```

`sentiment`: `"good" | "bad" | "neutral"`

## home-hub adds before persist

```json
{
  "id": "kap-disclosure-id",
  "date": "2026-07-21T12:00:00Z",
  "sourceUrl": "https://www.kap.org.tr/...",
  "language": "tr",
  "model": "qwen2.5:3b",
  "classifiedAt": "2026-07-21T12:05:00Z"
}
```

Merged stored record = model fields + home-hub fields above.

## Scraped / stored disclosure (minimum)

`id`, `date`, `stock`, `company`, `type`, `subject`/`title`, `summary`, `sourceUrl`, `language`

## Planned home-hub API (wrapper)

Browser talks only to home-hub, never to Ollama directly.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/kap/disclosures` | Watchlist + latest |
| `POST` | `/api/kap/classify` | Enqueue classify job |
| `GET` | `/api/kap/jobs/:id` | Job status |
| `POST` | `/api/kap/scrape` | Manual scrape run |

Exact paths may be adjusted at implement time; behavior stays as above.

## pi-llm references

- `CONTRACT.md` — canonical shared contract
- `examples/classify_kap.js` — reference Node client
- `prompts/kap_sentiment.txt` — classify prompt  
  On `ev`: home-hub loads it via `../pi-llm/prompts/kap_sentiment.txt`

## KAP sources

- Turkish: https://www.kap.org.tr/tr  
- English: https://www.kap.org.tr/en  

v1 uses **tr** only; `language` field kept for future `en`.
