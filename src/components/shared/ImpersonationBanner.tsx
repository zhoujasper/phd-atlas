import { useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";

const IMPERSONATION_MESSAGE_DWELL_MS = 2800;

type Props = {
  targetLabel: string;
  actorLabel: string;
  returnLabel: string;
  onReturn: () => void;
};

/**
 * A temporary, low-noise reminder for a delegated account view.
 *
 * The banner starts as a readable status surface so the context switch is
 * unambiguous, then keeps only the return action in the corner. Keeping this
 * state local prevents the shell from re-rendering just to drive a transient
 * presentation.
 */
export function ImpersonationBanner({
  targetLabel,
  actorLabel,
  returnLabel,
  onReturn,
}: Props) {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    setIsCompact(false);
    const timeoutId = window.setTimeout(() => {
      setIsCompact(true);
    }, IMPERSONATION_MESSAGE_DWELL_MS);

    return () => window.clearTimeout(timeoutId);
  }, [targetLabel, actorLabel, returnLabel]);

  return (
    <div
      className={`impersonation-banner${isCompact ? " is-compact" : ""}`}
      data-state={isCompact ? "compact" : "expanded"}
    >
      <div className="impersonation-banner-surface">
        <div
          className="impersonation-banner-copy"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-hidden={isCompact}
        >
          <span className="impersonation-banner-marker" aria-hidden="true" />
          <span className="impersonation-banner-copy-text">
            <strong>{targetLabel}</strong>
            <span>{actorLabel}</span>
          </span>
        </div>
        <button
          type="button"
          className="quiet-action impersonation-return-action"
          onClick={onReturn}
        >
          <ArrowRightLeft size={13} aria-hidden="true" />
          <span className="impersonation-return-label">{returnLabel}</span>
        </button>
      </div>
    </div>
  );
}
