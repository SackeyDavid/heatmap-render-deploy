import { Icon, type IconProps } from './Icon';

/** Success check for copy feedback and completion states. */
export function CheckIcon(props: Omit<IconProps, 'children'>) {
  const { size = 18, ...rest } = props;
  return (
    <Icon size={size} {...rest}>
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
    </Icon>
  );
}
