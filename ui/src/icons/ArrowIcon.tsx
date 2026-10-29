import { Icon, type IconProps } from './Icon';

export function ArrowIcon(props: Omit<IconProps, 'children'> & { direction?: 'right' | 'left' }) {
  const { direction = 'right', ...rest } = props;
  const transform = direction === 'left' ? 'scale(-1 1) translate(-24 0)' : undefined;
  return (
    <Icon {...rest}>
      <g transform={transform}>
        <path d="M13.5 4.5a.75.75 0 0 1 1.06 0l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 1 1-1.06-1.06L18.44 12l-4.94-4.94a.75.75 0 0 1 0-1.06Z" />
        <path d="M4.5 11.25a.75.75 0 0 1 .75-.75h12a.75.75 0 0 1 0 1.5h-12a.75.75 0 0 1-.75-.75Z" />
      </g>
    </Icon>
  );
}
