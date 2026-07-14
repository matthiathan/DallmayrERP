export function HamsterLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="hamster-loader" role="status" aria-live="polite" aria-label={label}>
      <div className="wheel-and-hamster" role="img" aria-label="Animated hamster running in a wheel">
        <div className="wheel" />
        <div className="hamster">
          <div className="hamster__body">
            <div className="hamster__head">
              <div className="hamster__ear" />
              <div className="hamster__eye" />
              <div className="hamster__nose" />
            </div>
            <div className="hamster__limb hamster__limb--fr" />
            <div className="hamster__limb hamster__limb--fl" />
            <div className="hamster__limb hamster__limb--br" />
            <div className="hamster__limb hamster__limb--bl" />
            <div className="hamster__tail" />
          </div>
        </div>
        <div className="spoke" />
      </div>
      <span className="hamster-loader__label">{label}</span>
    </div>
  );
}
