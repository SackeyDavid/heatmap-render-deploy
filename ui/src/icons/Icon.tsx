import type { ReactNode, SVGAttributes } from 'react';

export interface IconProps extends Omit<SVGAttributes<SVGElement>, 'children'> {
  size?: number;
  children: ReactNode;
  title?: string;
}

/** Inline SVG icon — uses currentColor; decorative by default (aria-hidden). */
export function Icon({ size = 20, className, title, children, ...rest }: IconProps) {
  const classes = className ? `hm-icon ${className}` : 'hm-icon';
  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
