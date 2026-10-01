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
        When you upload a recording, the audio is sent to a third-party speech-to-text service to make a
        transcript, and the text is sent to a third-party language model to make summaries and answer chat
        questions. Which providers are used depends on the endpoints the operator configures. Those providers
        handle the data under their own policies. We can&apos;t promise what they log, keep, or train on.
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
        unreadable, and then your notes and files are deleted on a best-effort basis.
      </p>
      <p>
        Backups are a limit here. A backup made before deletion may still contain your notes and your file
        key, and could be used to restore them until that backup is rotated out. Copies held by Clerk or the
        AI providers are outside this app&apos;s control.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top will change too.</p>
    </div>
  );
}
