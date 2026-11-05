type Props = { size?: 'sm' | 'lg'; tagline?: string; className?: string };

export function BrandLogo({ size = 'sm', tagline, className = '' }: Props) {
  return (
    <div className={`brand-logo brand-logo--${size}${className ? ` ${className}` : ''}`}>
      <img className="brand-logo-mark" src="/logo-mark.svg" alt="" />
      <span className="brand-logo-words">
        <span className="brand-logo-name">WeFood</span>
        {tagline && <span className="brand-logo-tagline">{tagline}</span>}
      </span>
    </div>
  );
}
