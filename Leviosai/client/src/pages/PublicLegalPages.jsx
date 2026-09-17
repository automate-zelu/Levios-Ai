/**
 * Public marketing + legal pages for Google OAuth consent screen.
 * Routes: /home (app homepage), /privacy, /terms — no auth required.
 */
import { Link } from "react-router-dom";
import "./public-site.css";

const CONTACT_EMAIL = "automate@zeluai.com";
const COMPANY = "Leviosai";
const EFFECTIVE = "September 17, 2026";

function Shell({ children, active }) {
  return (
    <div className="public-site">
      <div className="public-site-glow" aria-hidden="true" />
      <header className="public-site-nav">
        <Link to="/home" className="public-site-brand">
          <span className="public-site-mark" aria-hidden="true" />
          Leviosai
        </Link>
        <nav className="public-site-links" aria-label="Legal">
          <Link to="/home" className={active === "home" ? "is-on" : undefined}>Home</Link>
          <Link to="/privacy" className={active === "privacy" ? "is-on" : undefined}>Privacy</Link>
          <Link to="/terms" className={active === "terms" ? "is-on" : undefined}>Terms</Link>
          <Link to="/" className="public-site-cta">Sign in</Link>
        </nav>
      </header>
      <main className="public-site-main">{children}</main>
      <footer className="public-site-foot">
        <span>© {new Date().getFullYear()} {COMPANY}</span>
        <span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </span>
      </footer>
    </div>
  );
}

export function PublicHomePage() {
  return (
    <Shell active="home">
      <section className="public-hero">
        <p className="public-kicker">AI sales outreach</p>
        <h1>Leviosai</h1>
        <p className="public-lede">
          Voice, SMS, and email outreach that books meetings on your calendar —
          with your own Twilio number and Google or Outlook calendar.
        </p>
        <div className="public-actions">
          <Link to="/" className="public-btn public-btn--primary">Open app</Link>
          <Link to="/privacy" className="public-btn public-btn--ghost">Privacy policy</Link>
        </div>
      </section>
      <section className="public-block">
        <h2>What we connect</h2>
        <ul>
          <li><strong>Google Calendar</strong> — read availability and create appointments you confirm with leads.</li>
          <li><strong>Phone & SMS</strong> — outbound calling and messaging via your Twilio account.</li>
          <li><strong>Gmail (optional)</strong> — send follow-up email from your connected mailbox.</li>
        </ul>
      </section>
    </Shell>
  );
}

export function PublicPrivacyPage() {
  return (
    <Shell active="privacy">
      <article className="public-doc">
        <p className="public-kicker">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="public-meta">Effective date: {EFFECTIVE}</p>

        <p>
          This Privacy Policy describes how {COMPANY} (“we”, “us”) collects, uses, and shares
          information when you use the Leviosai application and related services (the “Service”).
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li><strong>Account data</strong> — name, email, password (hashed), organization, and billing identifiers.</li>
          <li><strong>Customer content</strong> — leads, call transcripts, messages, prompts, and booking details you store in the Service.</li>
          <li><strong>Connected services</strong> — when you connect Google Calendar, Gmail, Twilio, or similar providers, we receive OAuth tokens and the data those APIs expose for the scopes you approve (for example calendar free/busy and event create).</li>
          <li><strong>Usage & logs</strong> — product analytics, server logs, IP address, and device/browser metadata needed to operate and secure the Service.</li>
        </ul>

        <h2>2. How we use information</h2>
        <ul>
          <li>Provide, maintain, and improve the Service (including AI voice/SMS/email outreach and appointment booking).</li>
          <li>Authenticate you and enforce access controls for your organization.</li>
          <li>Process subscriptions, usage metering, and related billing.</li>
          <li>Comply with law, prevent abuse, and protect the security of the Service.</li>
          <li>Communicate about the Service (security notices, product updates, support).</li>
        </ul>

        <h2>3. Google user data</h2>
        <p>
          If you connect Google, we access Google user data only for the OAuth scopes you grant
          (typically Calendar availability and event creation, and optionally Gmail send).
          We use that data solely to provide the features you enable in Leviosai.
          We do not sell Google user data. We do not use Google user data for advertising.
          Tokens are stored encrypted at rest where applicable and can be revoked by disconnecting
          the integration in the app or via your Google Account permissions.
        </p>

        <h2>4. Sharing</h2>
        <p>We share information with:</p>
        <ul>
          <li><strong>Subprocessors</strong> that host or power the Service (e.g. cloud database, AI speech/LLM providers, email delivery, payments) under contractual confidentiality obligations.</li>
          <li><strong>Integrations you connect</strong> (Google, Twilio, etc.) as required to perform requested actions.</li>
          <li><strong>Legal authorities</strong> when required by law or to protect rights and safety.</li>
        </ul>

        <h2>5. Retention</h2>
        <p>
          We retain account and customer content for as long as your organization maintains an account
          and as needed for legal, billing, and security purposes. You may request deletion of account
          data by contacting us; some records may be retained where legally required.
        </p>

        <h2>6. Security</h2>
        <p>
          We use industry-standard measures including encryption in transit (HTTPS), access controls,
          and credential encryption for connected services. No method of transmission or storage is 100% secure.
        </p>

        <h2>7. Your choices</h2>
        <ul>
          <li>Disconnect Google or other integrations at any time in SDR Setup / settings.</li>
          <li>Revoke Google access at{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>.
          </li>
          <li>Contact us to access, correct, or delete personal data we hold about you where applicable.</li>
        </ul>

        <h2>8. Children</h2>
        <p>The Service is not directed to individuals under 16. We do not knowingly collect data from children.</p>

        <h2>9. Changes</h2>
        <p>We may update this policy. We will post the revised version on this page with an updated effective date.</p>

        <h2>10. Contact</h2>
        <p>
          Questions about privacy:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </article>
    </Shell>
  );
}

export function PublicTermsPage() {
  return (
    <Shell active="terms">
      <article className="public-doc">
        <p className="public-kicker">Legal</p>
        <h1>Terms of Service</h1>
        <p className="public-meta">Effective date: {EFFECTIVE}</p>

        <p>
          These Terms of Service (“Terms”) govern access to and use of the Leviosai Service operated by {COMPANY}.
          By creating an account or using the Service, you agree to these Terms.
        </p>

        <h2>1. The Service</h2>
        <p>
          Leviosai provides software for AI-assisted sales outreach (voice, SMS, email) and calendar booking.
          Features depend on your plan and the third-party accounts you connect (e.g. Twilio, Google).
        </p>

        <h2>2. Accounts</h2>
        <ul>
          <li>You must provide accurate registration information and keep credentials confidential.</li>
          <li>You are responsible for activity under your organization’s account.</li>
          <li>You must be at least 16 years old and able to form a binding contract.</li>
        </ul>

        <h2>3. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Violate telemarketing, TCPA, CAN-SPAM, GDPR, or other applicable outreach/privacy laws.</li>
          <li>Call or message people without required consent; ignore quiet hours or DNC obligations.</li>
          <li>Use the Service for fraud, harassment, spam, or unlawful content.</li>
          <li>Attempt to breach security, reverse engineer, or disrupt the Service.</li>
          <li>Misrepresent AI calls as a human where disclosure is required.</li>
        </ul>

        <h2>4. Customer content & integrations</h2>
        <p>
          You retain ownership of leads, prompts, and other content you upload.
          You grant us a license to process that content solely to provide the Service.
          You are responsible for obtaining rights and consents for the data and destinations you use.
          Third-party services (Google, Twilio, etc.) are governed by their own terms; we are not liable for their outages or policy changes.
        </p>

        <h2>5. AI outputs</h2>
        <p>
          AI-generated speech and text may be inaccurate or inappropriate. You remain responsible for reviewing
          and supervising outreach and bookings made through the Service.
        </p>

        <h2>6. Fees</h2>
        <p>
          Paid plans, usage (minutes, messages), and appointment fees are described in-product and/or your order form.
          Fees are non-refundable except where required by law. We may suspend access for non-payment.
        </p>

        <h2>7. Intellectual property</h2>
        <p>
          The Service, branding, and software are owned by {COMPANY} and its licensors.
          These Terms do not grant you rights to our trademarks or source code beyond using the Service as offered.
        </p>

        <h2>8. Disclaimers</h2>
        <p>
          THE SERVICE IS PROVIDED “AS IS” WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED,
          INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, {COMPANY.toUpperCase()} WILL NOT BE LIABLE FOR INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, OR BUSINESS.
          OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE IS LIMITED TO THE AMOUNTS YOU PAID US
          FOR THE SERVICE IN THE THREE (3) MONTHS BEFORE THE CLAIM.
        </p>

        <h2>10. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate access for breach of these Terms,
          legal risk, or non-payment. Provisions that should survive (including liability limits) will survive termination.
        </p>

        <h2>11. Changes</h2>
        <p>
          We may update these Terms by posting a revised version on this page. Continued use after the effective date
          constitutes acceptance of the updated Terms.
        </p>

        <h2>12. Contact</h2>
        <p>
          Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </article>
    </Shell>
  );
}
