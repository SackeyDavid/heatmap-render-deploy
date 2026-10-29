import { Icon, type IconProps } from './Icon';

export function AlertIcon(props: Omit<IconProps, 'children'>) {
  return (
    <Icon {...props}>
      <path d="M12 2.25 2.25 19.5h19.5L12 2.25Zm0 3.52 6.28 11.23H5.72L12 5.77ZM11.25 10v3.75h1.5V10h-1.5Zm0 5.25v1.5h1.5v-1.5h-1.5Z" />
    </Icon>
  );
}
