# MindSync
Mobile-first anonymous couple games and personalised surprises.

## Run locally
Node.js 20.9+ recommended. `npm install`, copy `.env.example` to `.env.local`, then `npm run dev`. Local previews work without Supabase. Publishing requires configuration.

## Deploy from GitHub (phone friendly)
1. Extract ZIP and upload its contents (including app folder and hidden config files) to a new GitHub repository, or use GitHub Codespaces to upload/extract it.
2. Create a Supabase project. Run schema.sql in its SQL editor.
3. In Vercel import your GitHub repository. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in project environment variables using Supabase project settings. Never commit the service role key or prefix it NEXT_PUBLIC_.
4. Deploy. Open your deployment, create a game or gift and generate links. Keep the creator results link private.

## Scope
Six themes, original synthesized background notes, editable questions and expected answers, eight themed gift layouts with editable secrets, treasure hunt clues, local preview, anonymous remote links, single partner submission and creator result refresh. Other gift modes currently use tap-to-reveal interactions; advanced scratch gestures, photo/voice uploads, timed reveals, and bilateral scores are not implemented. Results access uses a secret bearer URL; anyone with the play URL can submit once. Gift contents are delivered to the recipient browser. No encryption beyond HTTPS, expiry, abuse throttling or automatic deletion is implemented. Add those controls before a public launch. Do not use for sensitive secrets. No automated end-to-end tests included; verify deployment manually.
