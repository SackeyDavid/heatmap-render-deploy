import { Icon, type IconProps } from './Icon';

export function ExternalLinkIcon(props: Omit<IconProps, 'children'>) {
  return (
    <Icon {...props}>
      <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3ZM5 5h6V3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-6h-2v6H5V5Z" />
    </Icon>
  );
}
