import type { Metadata } from "next";
import LegalPage from "../components/legal/LegalPage";
import paragraphs from "../components/legal/privacy.json";

export const metadata: Metadata = {
  title: "Privacy Policy | Notes",
  description: "Privacy Policy for Notes.",
};

export default function Page() {
  return <LegalPage paragraphs={paragraphs} download="/legal/privacy.md" />;
}
