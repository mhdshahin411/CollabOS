# n8n — CollabOS ingestion layer

Local, self-hosted (free Community edition). n8n receives messages from your
connected channels and forwards each one to the CollabOS app.

## Run
```bash
cd n8n
cp .env.example .env          # then set POSTGRES_PASSWORD and N8N_ENCRYPTION_KEY
openssl rand -hex 32          # use the output for N8N_ENCRYPTION_KEY
docker compose up -d
open http://localhost:5678    # create your local owner account
```

## The one node that talks to CollabOS
Every channel workflow ends in an **HTTP Request** node:

- Method: `POST`
- URL: `http://host.docker.internal:3000/api/ingest`
- Header: `x-webhook-secret: <same value as N8N_WEBHOOK_SECRET in the app's .env.local>`
- Body (JSON):
  ```json
  {
    "user_id": "<your CollabOS user uuid>",
    "channel": "gmail",
    "raw_text": "={{ $json.text }}",
    "sender": "={{ $json.from }}",
    "external_thread_id": "={{ $json.threadId }}",
    "external_message_id": "={{ $json.messageId }}"
  }
  ```
  `external_message_id` is what makes n8n retries safe — always send it.

## Real Gmail / Instagram / WhatsApp webhooks
Meta and Google must reach n8n over the public internet. For local dev, tunnel:
```bash
cloudflared tunnel --url http://localhost:5678
```
Then set `WEBHOOK_URL` to the tunnel URL and restart, and register that URL in
the Meta App dashboard / Gmail push config. Until then, use each trigger node's
"Listen for test event" or the manual trigger to test end to end.

## Driving n8n from Claude via MCP (optional)
1. In n8n: Settings → API → create an API key.
2. Add the MCP server (in an interactive terminal, not this session):
   ```bash
   claude mcp add n8n -- npx n8n-mcp
   ```
   with env N8N_API_URL=http://localhost:5678  N8N_API_KEY=<the key>
3. Then Claude can create/validate/deploy these workflows for you directly.
