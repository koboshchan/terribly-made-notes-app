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
        Speech-to-text transcription is run locally on our infrastructure, and your audio recordings are never
        uploaded to any third party. To generate summaries, study tools, and answer chat questions, note text is
        processed using language model endpoints configured by the operator, strictly to fulfill your requests and
        under configurations where your data is not used for model training.
      </p>

      <h2>Recordings and consent</h2>
      <p>
        Only upload recordings you have the right to share. If other people can be heard, you are responsible
        for getting any consent the law requires.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        Your data is destroyed fully upon account deletion, and can be requested to be deleted via email at{" "}
        <a href="mailto:lz@kjt.lol">lz@kjt.lol</a>.
      </p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top will change too.</p>
    </div>
  );
}
