// front/components/NavigationArrow.tsx
import React from 'react';
import Svg, { Path } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;
  rotation?: number;
};

export const NavigationArrow: React.FC<Props> = ({
  size = 40,
  color = '#007AFF',
  rotation = 0,
}) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    style={{
      transform: [{ rotate: `${rotation}deg` }],
    }}
  >
    {/* ▲シンプルな矢印形状 */}
    <Path
      d="M12 2 L19 21 L12 17 L5 21 Z"
      fill={color}
      stroke="white"
      strokeWidth={1}
      strokeLinejoin="round"
    />
  </Svg>
);
