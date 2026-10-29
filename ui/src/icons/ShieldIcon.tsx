import { Icon, type IconProps } from './Icon';

export function ShieldIcon(props: Omit<IconProps, 'children'>) {
  return (
    <Icon {...props}>
      <path d="M12 2.25 4.5 5.25v5.25c0 4.28 3.15 8.28 7.5 9.25 4.35-.97 7.5-4.97 7.5-9.25V5.25L12 2.25Zm0 2.08 4.5 1.8v4.47c0 3.1-2.28 6.02-5.44 6.82-.03 0-.06 0-.06 0-3.16-.8-5.44-3.72-5.44-6.82V6.13L12 4.33Z" />
    </Icon>
  );
}
