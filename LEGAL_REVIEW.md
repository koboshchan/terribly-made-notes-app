# Publication review, not legal advice

These are unpublished drafts adapted from the existing CC0 templates. A qualified reviewer should assess them before use. They are not an organizational negotiation playbook or a legal-compliance certification.

## Source and deployment scope

Reviewed October 15, 2026 against web main 6bae131, merged into the existing legal branch without rewriting history. The legal pages and their Markdown downloads must remain in sync. Web redesign, single/bulk sharing, revocation, chat and rate limits, administrative settings/concurrency, durable processing, file encryption and signed Clerk account-deletion webhook were inspected. TTS remains provider configuration only in this web source, not an implemented synthesis route/player; do not advertise it as deployed playback. iOS cache and extension-token disclosures reflect the existing companion code and need release-specific review.

At review time production had not adopted 6bae131: deployment was halted with existing plaintext files requiring an offline migration. This PR neither performs that migration nor claims the live site is encrypted. Do not publish the draft until the intended release and actual deployment are reconciled.

## Publication blockers requiring operator confirmation

- Confirm operator identity, privacy contact, minor-run status, guardian/legal review and permitted user ages/meaningful-consent approach. Under-13 exclusion is a proposed policy, not enforced age verification.
- Set an effective date only after review; implement the promised material-change notice and consent process.
- Identify active STT/LLM operators, proxy upstreams, Clerk and all hosting/network/storage providers, their processing/storage countries, contractual safeguards, request retention and model-training terms. Configurable defaults and intended self-hosted Speaches are not deployment evidence.
- Confirm live FILE_ENCRYPTION_MASTER_KEY custody/rotation/recovery, permission safeguards, offline legacy-file migration, MongoDB protection and encrypted-backup scope. File encryption does not encrypt database records or guarantee end-to-end encryption.
- Configure and verify CLERK_WEBHOOK_SIGNING_SECRET, user.deleted delivery, retries and alerting; test account cleanup on the deployed version. No unlimited retry or completion-time guarantee.
- Document note, failed-upload, queue, plaintext-temp, database, operational-log and backup retention/deletion intervals and who handles failed cleanup or access/correction/withdrawal requests. No arbitrary deletion SLA.
- Confirm active share expiry (operator setting, default 30 days; old links may lack expiry), public-chat permissions, trusted-proxy configuration and release-specific revocation controls. Individual and bulk links are independent.
- Check the shipping iOS version's microphone/import flows, local cache and app-group token storage, device backups and deletion behavior; server deletion does not erase recipient/device copies.
- Obtain qualified review of Canadian/BC privacy applicability, cross-border disclosures, recording consent, age/operator capacity and liability terms. Code inspection alone is not legal advice.

## Code evidence

- lib/storage.ts, lib/file-crypto.ts, lib/file-keys.ts: file envelope encryption, master-key wrapping, temporary decrypted files, tombstones.
- lib/account-deletion.ts, app/api/user/route.ts, app/api/webhooks/clerk/route.ts: key-first destruction, cancellation/cleanup, failure responses requesting webhook retry.
- lib/share.ts, app/api/notes/[id]/share/route.ts, app/api/notes/share-bulk/route.ts and public shared routes: independent link types, default-off public chat, configured expiry, note ownership/status checks.
- lib/chat.ts, lib/usage.ts: bounded request history, provider context, hashed public-chat counters with TTL indexes.
- lib/upload.ts, lib/queue.ts, lib/processing.ts: audio metadata/fingerprints, durable processing, transcript/summary/study outputs, original cleanup after success, provider error logs.
- app/chat-multi/page.tsx and note/shared chat pages: page-memory conversations, no persistent conversation write in these flows.
- app/admin/models/page.tsx and app/api/admin/models/route.ts: administrator settings, including provider credentials and concurrency; TTS settings alone do not synthesize speech.
