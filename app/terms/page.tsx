import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service | terribly made notes app" };

export default function TermsPage() {
  return (
    <div className="container" style={{ maxWidth: 760, lineHeight: 1.6, padding: "32px 20px" }}>
      <h1>Terms of Service</h1>
      <p><em>Last updated October 1, 2026</em></p>
      <p>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of <strong>notes.kobosh.com</strong> and
        the terribly made notes app (&quot;Service&quot;, &quot;App&quot;), operated by the service operator (&quot;we&quot;,
        &quot;us&quot;, or &quot;operator&quot;). Contact: <a href="mailto:lz@kjt.lol">lz@kjt.lol</a>.
      </p>
      <p>
        By creating an account, accessing, or using the Service, you agree to be bound by these Terms and our{" "}
        <Link href="/privacy">Privacy Policy</Link>, which is incorporated herein by reference. If you do not agree to these
        Terms, do not access or use the Service.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 13 years of age (or the minimum age of legal digital consent in your jurisdiction) to access or
        use the Service. If you are under the age of majority in your jurisdiction, you represent and warrant that you have
        obtained the consent of your parent or legal guardian to agree to these Terms. By using the Service, you represent
        that you have the legal capacity to enter into a binding contract.
      </p>

      <h2>2. Accounts and Security</h2>
      <p>
        Authentication is managed through Clerk. You are responsible for safeguarding your login credentials and for any
        activity or actions conducted under your account. You agree to notify the operator immediately at{" "}
        <a href="mailto:lz@kjt.lol">lz@kjt.lol</a> if you discover or suspect any unauthorized access to or security breach of
        your account.
      </p>

      <h2>3. User Content and Limited License</h2>
      <p>
        You retain all ownership, intellectual property rights, and copyright in and to the audio recordings, notes,
        transcripts, text, study materials, and other content that you upload, submit, or generate through the Service
        (&quot;User Content&quot;).
      </p>
      <p>
        You grant the operator a limited, non-exclusive, worldwide, royalty-free license to host, store, transfer, decrypt,
        format, and process your User Content solely as necessary to operate, maintain, and provide the Service to you.
        Speech-to-text transcription runs locally on our infrastructure, and your audio recordings are never uploaded to any
        third party. Transcribed note text may be processed using configured language model endpoints solely to fulfill your
        summary, chat, and study tool requests.
      </p>
      <p>
        <strong>No Model Training:</strong> As detailed in our <Link href="/privacy">Privacy Policy</Link>, your User Content
        and transcripts are never used to train artificial intelligence or machine learning models, and are never sold,
        licensed, or disclosed to the public (except where you explicitly choose to create a public share link).
      </p>
      <p>
        This limited license terminates when you delete your User Content or delete your account, subject only to ordinary,
        temporary backup rotation cycles.
      </p>

      <h2>4. Recording Consent and Wiretapping Laws</h2>
      <p>
        You are solely responsible for ensuring that any audio or audiovisual recordings you upload to the Service comply with
        all applicable local, state, national, and international laws, including two-party, all-party, or one-party consent
        wiretapping and recording statutes.
      </p>
      <p>
        You represent and warrant that you have obtained all necessary permissions, rights, and legally valid consents from
        all individuals whose voices, likenesses, or statements are captured in any recordings you upload before submitting
        them to the Service.
      </p>

      <h2>5. Public Links and Sharing</h2>
      <p>
        The Service provides optional sharing features that allow you to generate shareable links for individual notes or
        curated collections. Anyone who obtains a shareable link will be able to view the shared note content and any
        associated study materials.
      </p>
      <p>
        You are solely responsible for any content you choose to share publicly. You may revoke or delete a share link at
        any time within the App, though third parties who previously accessed or copied the shared content may retain copies
        outside the Service&apos;s control.
      </p>

      <h2>6. Acceptable Use and Prohibited Conduct</h2>
      <p>You agree not to use the Service to:</p>
      <ul>
        <li>Violate any applicable federal, state, local, or international law, regulation, or court order;</li>
        <li>
          Infringe, misappropriate, or violate the copyrights, trademarks, privacy, publicity, or other proprietary rights of
          any third party;
        </li>
        <li>
          Upload or distribute viruses, worms, trojans, spyware, malware, or any other software designed to damage, disrupt,
          or obtain unauthorized access to any system, network, or data;
        </li>
        <li>
          Probe, scan, test the vulnerability of, or breach any security, encryption, or authentication mechanisms of the
          Service;
        </li>
        <li>
          Circumvent, evade, or attempt to bypass rate limits, admission locks, authentication checks, or API access controls;
        </li>
        <li>
          Scrape, crawl, harvest, or extract data from the Service using automated means without explicit authorization;
        </li>
        <li>
          Reverse engineer, decompile, disassemble, or derive the source code of the Service, except where such restriction is
          expressly prohibited by applicable law;
        </li>
        <li>
          Interfere with or disrupt the operation of the Service, servers, or networks connected to the Service.
        </li>
      </ul>

      <h2>7. AI-Generated Output and Disclaimers</h2>
      <p>
        Transcripts, summaries, quizzes, flashcards, and chat responses are generated by automated artificial intelligence
        systems (&quot;AI Output&quot;).
      </p>
      <p>
        AI Output is generated algorithmically and may contain errors, hallucinations, inaccuracies, omissions, or outdated
        information. You are responsible for independently verifying all critical information before relying on it.
      </p>
      <p>
        AI Output does not constitute professional advice of any kind, including legal, medical, financial, tax, or academic
        advising. The operator makes no representations, guarantees, or warranties regarding the accuracy, completeness, or
        reliability of any AI Output.
      </p>

      <h2>8. Third-Party Services and Endpoints</h2>
      <p>
        The Service relies on third-party services, including Clerk for identity management and operator-configured language model
        providers for text summarization and chat. Speech-to-text transcription runs locally on our infrastructure, and your
        audio recordings are never uploaded to any third-party speech-to-text service. Your interaction with third-party
        authentication and language model services is subject to the respective third party&apos;s terms and policies.
      </p>

      <h2>9. Termination and Suspension</h2>
      <p>
        You may stop using the Service and terminate your account at any time through the App settings. Upon account deletion,
        your data is destroyed fully in accordance with our <Link href="/privacy">Privacy Policy</Link>. You may also request
        deletion of your data via email at <a href="mailto:lz@kjt.lol">lz@kjt.lol</a>.
      </p>
      <p>
        The operator reserves the right to suspend, restrict, or terminate your access to the Service at any time, with or
        without notice, if you breach these Terms, engage in abusive or unlawful behavior, or if necessary to safeguard the
        Service or other users.
      </p>

      <h2>10. Disclaimer of Warranties</h2>
      <p style={{ textTransform: "uppercase", fontSize: "0.95em" }}>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICE IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS
        AVAILABLE&quot; BASIS, WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. THE OPERATOR
        SPECIFICALLY DISCLAIMS ALL IMPLIED WARRANTIES, INCLUDING WITHOUT LIMITATION ANY WARRANTIES OF MERCHANTABILITY, FITNESS
        FOR A PARTICULAR PURPOSE, TITLE, QUIET ENJOYMENT, AND NON-INFRINGEMENT.
      </p>
      <p style={{ textTransform: "uppercase", fontSize: "0.95em" }}>
        THE OPERATOR DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, TIMELY, SECURE, ACCURATE, OR ERROR-FREE, OR THAT
        ANY DEFECTS WILL BE CORRECTED, OR THAT CONTENT OR DATA WILL NOT BE LOST, ALTERED, OR CORRUPTED.
      </p>

      <h2>11. Limitation of Liability</h2>
      <p style={{ textTransform: "uppercase", fontSize: "0.95em" }}>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE OPERATOR BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, DATA, USE, GOODWILL, OR
        OTHER INTANGIBLE LOSSES, ARISING OUT OF OR IN CONNECTION WITH: (A) YOUR ACCESS TO, USE OF, OR INABILITY TO ACCESS OR
        USE THE SERVICE; (B) ANY CONTENT OR CONDUCT OF ANY THIRD PARTY; (C) ANY AI-GENERATED TRANSCRIPTS OR SUMMARIES; OR (D)
        UNAUTHORIZED ACCESS, USE, OR ALTERATION OF YOUR RECORDINGS, DATA, OR TRANSMISSIONS.
      </p>
      <p style={{ textTransform: "uppercase", fontSize: "0.95em" }}>
        IN NO EVENT SHALL THE AGGREGATE LIABILITY OF THE OPERATOR FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR
        THE SERVICE EXCEED THE GREATER OF ONE HUNDRED U.S. DOLLARS ($100.00) OR THE TOTAL AMOUNT ACTUALLY PAID BY YOU TO THE
        OPERATOR FOR ACCESS TO THE SERVICE IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.
      </p>

      <h2>12. Indemnification</h2>
      <p>
        To the extent permitted by applicable law, you agree to indemnify, defend, and hold harmless the operator from and
        against any and all claims, liabilities, damages, losses, costs, and expenses (including reasonable attorneys&apos; fees)
        arising out of or related to: (a) your use of or access to the Service; (b) your User Content, including any claims
        alleging violation of wiretapping, recording consent, or privacy laws; (c) your breach of any provision of these Terms;
        or (d) your violation of any rights of another person or entity.
      </p>

      <h2>13. Dispute Resolution and Governing Law</h2>
      <p>
        These Terms and any dispute, claim, or controversy arising out of or related to them or the Service shall be governed
        by and construed in accordance with the laws of the State of California, United States, without regard to its conflict
        of law principles.
      </p>
      <p>
        <strong>Informal Resolution:</strong> Before initiating any formal legal proceeding, you agree to contact the operator
        at <a href="mailto:lz@kjt.lol">lz@kjt.lol</a> and attempt in good faith to resolve the dispute informally for at least
        thirty (30) days.
      </p>
      <p>
        <strong>Class Action Waiver:</strong> TO THE MAXIMUM EXTENT PERMITTED BY LAW, ALL CLAIMS AND DISPUTES MUST BE BROUGHT
        IN AN INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS ACTION, COLLECTIVE ACTION,
        PRIVATE ATTORNEY GENERAL PROCEEDING, OR OTHER REPRESENTATIVE PROCEEDING.
      </p>

      <h2>14. General Provisions</h2>
      <p>
        <strong>Severability:</strong> If any provision of these Terms is found to be unlawful, void, or unenforceable, that
        provision will be severed and the remaining provisions will remain in full force and effect.
      </p>
      <p>
        <strong>Entire Agreement:</strong> These Terms, together with the <Link href="/privacy">Privacy Policy</Link>, constitute
        the entire legal agreement between you and the operator concerning the Service.
      </p>
      <p>
        <strong>No Waiver:</strong> The failure of the operator to enforce any right or provision of these Terms will not be
        deemed a waiver of such right or provision.
      </p>
      <p>
        <strong>Changes to Terms:</strong> We may update these Terms from time to time. When changes are published, the &quot;Last
        updated&quot; date at the top of this page will be revised. Your continued use of the Service after the effective date
        of any revised Terms constitutes your acceptance of the updated Terms.
      </p>
    </div>
  );
}
