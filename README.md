# terribly made notes app

Uploads audio files, transcribes them, and generates summarized markdown notes using OpenAI-compatible STT and LLM APIs.

## Stack

- Next.js 15, TypeScript
- Clerk (auth)
- MongoDB
- FFmpeg
- Docker

## Setup

1. Copy and fill in credentials:

```bash
cp .env.local.example .env.local
```

`.env.local` requires:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

2. Run:

```bash
docker compose up
```

App is available at http://localhost:3000.

To build locally instead of pulling the pre-built image:

```bash
docker compose up --build
```

## First-time configuration

After signing in, go to Settings and configure:

- **STT**: base URL, API key, model, task (transcribe/translate)
- **LLM**: base URL, API key, model

Both accept any OpenAI-compatible API.

## Shared notes

Any completed note can be shared via a public link (Share Link button on the note page). Anyone with the link can view the markdown and open a chat against it without an account.
