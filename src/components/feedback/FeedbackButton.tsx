import { MessageSquare } from "lucide-react";

import { FEEDBACK_FORM_URL } from "@/lib/feedback";

/**
 * A floating "Feedback Hub" button for pages where a student may be stuck (the login form), so they can report
 * a problem or send a suggestion without signing in. Styled by `.feedback-fab` in StudentLogin.css.
 */
export default function FeedbackButton() {
  return (
    <a
      href={FEEDBACK_FORM_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="feedback-fab"
      title="Feedback Hub"
      aria-label="Send feedback, a suggestion or a bug report (opens in a new tab)"
    >
      <MessageSquare size={20} aria-hidden="true" />
    </a>
  );
}
