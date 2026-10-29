import { Icon, type IconProps } from './Icon';

type DecorativeIconProps = Omit<IconProps, 'children'>;

export function PageIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2.75h7.2L19 8.55v12.7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17.5a1 1 0 0 1 1-1Z" />
      <path d="M13 3.5v5h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 13h8M8 16.5h8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </Icon>
  );
}

export function KeyIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="M8.25 14.75a5.5 5.5 0 1 1 4.74-2.72L21 12v3h-3v3h-3v3h-3v-4.1a5.47 5.47 0 0 1-3.75-2.15Zm0-3.1a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z" />
    </Icon>
  );
}

export function MailIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 5.5h17a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 17V7a1.5 1.5 0 0 1 1.5-1.5Zm.15 2.2 7.7 5.55a1.1 1.1 0 0 0 1.3 0l7.7-5.55" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function CodeIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="m8.5 6-6 6 6 6M15.5 6l6 6-6 6M13.5 4l-3 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </Icon>
  );
}

export function PlusIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z" />
    </Icon>
  );
}

export function MinusIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="M5 11a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2H5Z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: DecorativeIconProps) {
  return (
    <Icon {...props}>
      <path d="M5.3 8.8a1 1 0 0 1 1.4 0L12 14.1l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z" />
    </Icon>
  );
}

export function CloseIcon(props: Omit<IconProps, 'children'>) {
  const { size = 18, ...rest } = props;
  return (
    <Icon size={size} {...rest}>
      <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29l6.29 6.3 6.3-6.3 1.41 1.42z" />
    </Icon>
  );
}
