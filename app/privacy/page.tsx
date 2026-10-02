import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy | terribly made notes app" };

export default function PrivacyPage() {
  return (
    <div className="container" style={{ maxWidth: 720, lineHeight: 1.6, padding: "32px 20px" }}>
      <h1>Privacy Policy</h1>
      <p><em>Last updated October 1, 2026</em></p>
      <p>
        notes.kobosh.com is a personal service run by one person. This page says what data it handles and
        what happens to it. Questions or requests go to <a href="mailto:lz@kjt.lol">lz@kjt.lol</a>.
      </p>

      <h2>What we store</h2>
      <p>
        Sign-in is handled by Clerk, which keeps your account details (such as email and name) under its own
        privacy policy. The app keeps your account data, settings, and the text of your notes, transcripts,
        summaries and chats in a MongoDB database. Uploaded recordings and files generated from them are
        stored on the server&apos;s disk.
      </p>

      <h2>AI processing</h2>
      <p>
        Your uploaded audio is saved solely to transcribe your audio to text and generate your notes, summaries,
        and study materials. We promise that your audio and transcripts are never used to train artificial
        intelligence or machine learning models, and are never shared, sold, or provided to the public (unless you
        explicitly choose to create a public share link for a note).
      </p>
      <p>
        To perform transcription and generate summaries, audio and note text are sent to speech-to-text and
        language model endpoints configured by the operator. These services process your data strictly to fulfill
        your requests and under configurations where your data is not used for model training.
      </p>

      <h2>Recordings and consent</h2>
      <p>
        Only upload recordings you have the right to share. If other people can be heard, you are responsible
        for getting any consent the law requires.
      </p>

      <h2>Public links</h2>
      <p>
        If you create a share link for a note, anyone who has that link can view it. You can delete a share
        link to stop access, but people who already saw or copied the content may still have it.
      </p>

      <h2>Encryption</h2>
      <p>
        Audio and generated files on disk are encrypted with a key unique to your account. That key is itself
        encrypted with a server master key and stored in the database. This is not end-to-end encryption: the
        server can decrypt your files to process them. Note text in MongoDB is not covered by this encryption.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Your data stays until you delete it or delete your account. You can delete individual notes at any
        time. When you delete your account, your file key is destroyed first, which makes the encrypted files
        unreadable. Then all live data tied to your account is permanently deleted from MongoDB and disk: notes,
        transcripts, summaries, study materials, share links, shortcut tokens, processing jobs, settings, any
        chat history stored on the server, and your files. If that cleanup is interrupted, it is retried when
        Clerk sends its signed account-deletion notice, so it can take a little while to finish.
      </p>
      <p>
        We keep a small permanent deletion record and nonce safety records so a key for your account can never
        be recreated or reused. These contain no note content or files.
      </p>
      <p>
        Backups are a limit here. A backup made before deletion may still contain your notes and your file
        key, and could be used to restore them until that backup is rotated out. Transient operational logs held
        by Clerk or upstream AI service providers are outside this app&apos;s direct control, though providers
        are configured under commitments that do not train on your data.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top will change too.</p>
    </div>
  );
}
