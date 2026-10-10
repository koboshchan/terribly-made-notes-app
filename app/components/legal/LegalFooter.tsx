import Link from "next/link";
import styles from "./legal.module.css";

export default function LegalFooter() {
  return (
    <footer className={styles.footer} aria-label="Legal information">
      <Link href="/terms">Terms of Service</Link>
      <Link href="/privacy">Privacy Policy</Link>
    </footer>
  );
}
