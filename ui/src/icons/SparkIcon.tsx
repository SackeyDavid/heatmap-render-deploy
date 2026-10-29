import { Icon, type IconProps } from './Icon';

/** Four-point spark — helper / working state. */
export function SparkIcon(props: Omit<IconProps, 'children'>) {
  return (
    <Icon {...props}>
      <path d="M12 2.5 13.4 8.6 19.5 10 13.4 11.4 12 17.5 10.6 11.4 4.5 10 10.6 8.6 12 2.5Z" />
      <path d="M19 3.5 19.6 5.9 22 6.5 19.6 7.1 19 9.5 18.4 7.1 16 6.5 18.4 5.9 19 3.5Z" opacity="0.85" />
    </Icon>
  );
}
