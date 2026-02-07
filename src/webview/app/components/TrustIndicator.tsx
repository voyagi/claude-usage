/**
 * Trust indicator badge showing local-only data processing.
 * Displays a lock icon and "Local Only" text to emphasize privacy.
 */
export function TrustIndicator() {
  return (
    <div className="trust-indicator">
      <span className="trust-indicator-icon" role="img" aria-label="Lock">
        🔒
      </span>
      <span>Local Only</span>
    </div>
  );
}
