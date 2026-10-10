import type { Metadata } from "next";
import LegalPage from "../components/legal/LegalPage";
import paragraphs from "../components/legal/terms.json";

export const metadata: Metadata = {
  title: "Terms of Service | Notes",
  description: "Terms of Service for Notes.",
};

export default function Page() {
  return <LegalPage paragraphs={paragraphs} download="/legal/terms.md" />;
}
