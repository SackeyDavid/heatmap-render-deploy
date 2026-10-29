import { Icon, type IconProps } from './Icon';

export function SpinnerIcon(props: Omit<IconProps, 'children'>) {
  const { className, ...rest } = props;
  const classes = className ? `hm-spinner-icon ${className}` : 'hm-spinner-icon';
  return (
    <Icon className={classes} {...rest}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path d="M12 3a9 9 0 0 1 8.66 6.5H18.4A6.5 6.5 0 1 0 12 18.5V21a9 9 0 0 1 0-18z" opacity="0.85" />
    </Icon>
  );
}
