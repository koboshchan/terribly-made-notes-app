import Link from "next/link";
import styles from "./legal.module.css";

export default function LegalPage({
  paragraphs,
  download,
}: {
  paragraphs: string[];
  download: string;
}) {
  return (
    <article className={styles.document}>
      <nav aria-label="Legal pages" className={styles.navigation}>
        <Link href="/">Back to app</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <a href={download} download>Download Markdown</a>
      </nav>
      <h1>{paragraphs[0]}</h1>
      {paragraphs.slice(1).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </article>
  );
}
