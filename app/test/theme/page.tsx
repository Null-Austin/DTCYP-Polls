import PollLogo from "@/components/poll/logo"
import DebugAlert from "@/components/debug-alert"
import DebugButton from "@/components/debug-button"
import PollOption from "@/components/poll/poll-option"
import StatusBadge from "@/components/poll/status-badge"
import VersionText from "@/components/versiontext"

export default function ThemeTestPage() {
  return (
    <main className="theme-page">
      <header className="theme-page__header">
        <PollLogo />
        <span className="theme-page__meta">Theme debug page</span>
      </header>

      <section className="debug-page__intro">
        <p className="theme-page__kicker">Component reference</p>
        <h1>Theme debug page</h1>
        <p>Small, visible examples of the pieces used across the poll experience.</p>
      </section>

      <section className="debug-page__sections" aria-label="Component examples">
        <div className="debug-section">
          <h2>Text</h2>
          <div className="debug-section__content debug-type-samples">
            <h1>Heading one</h1>
            <h2>Heading two</h2>
            <p>Body text for questions, descriptions, and other useful context.</p>
            <small>Small supporting text and metadata</small>
            <code>poll.response.count</code>
          </div>
        </div>

        <div className="debug-section">
          <h2>Logo</h2>
          <div className="debug-section__content debug-logo-sample"><PollLogo /></div>
        </div>

        <div className="debug-section">
          <h2>Buttons</h2>
          <div className="debug-section__content debug-row">
            <DebugButton>Continue</DebugButton>
            <DebugButton variant="secondary">Save draft</DebugButton>
            <DebugButton variant="quiet">Cancel</DebugButton>
            <DebugButton variant="danger">Delete</DebugButton>
          </div>
        </div>

        <div className="debug-section">
          <h2>Alerts</h2>
          <div className="debug-section__content debug-stack">
            <DebugAlert title="Heads up">This poll closes tomorrow.</DebugAlert>
            <DebugAlert title="Saved" tone="success">Your response was recorded.</DebugAlert>
            <DebugAlert title="Something went wrong" tone="error">Try submitting your response again.</DebugAlert>
          </div>
        </div>

        <div className="debug-section">
          <h2>Inputs</h2>
          <div className="debug-section__content debug-form">
            <label htmlFor="question">Question</label>
            <input id="question" placeholder="Ask something useful..." />
            <label className="debug-checkbox"><input type="checkbox" defaultChecked /> Allow multiple answers</label>
          </div>
        </div>

        <div className="debug-section">
          <h2>Poll pieces</h2>
          <div className="debug-section__content debug-stack">
            <div className="debug-row"><StatusBadge>Live now</StatusBadge><StatusBadge tone="closed">Closed</StatusBadge><StatusBadge tone="draft">Draft</StatusBadge></div>
            <PollOption label="A visible result" votes={57} percentage={57} selected />
            <PollOption label="A second option" votes={31} percentage={31} accent="lime" />
          </div>
        </div>
      </section>

      <footer className="theme-page__footer">
        <span>All examples are intentionally simple.</span>
        <span><VersionText /></span>
      </footer>
    </main>
  )
}