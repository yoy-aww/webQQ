import type { CSSProperties } from 'react';

interface AvatarProps {
  src?: string;
  name: string;
  size?: number;
  online?: boolean;
  style?: CSSProperties;
  square?: boolean;
}

/** 是否为可显示的真实图片（服务端上传的都带 /uploads/ 前缀） */
function isRealImage(src?: string): boolean {
  return !!src && src.startsWith('/uploads/');
}

const palette = ['#4aa8f0', '#f0a04a', '#7cc576', '#c97bd6', '#e6696a', '#5aa0d6', '#d6a04a', '#6bbcd4'];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % palette.length;
  return palette[h];
}

export function Avatar({ src, name, size = 38, online, style, square }: AvatarProps) {
  const isImg = isRealImage(src);
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        borderRadius: square ? size * 0.18 : '50%',
        color: isImg ? undefined : '#fff',
        background: isImg ? '#eef2f7' : hashColor(name || '?'),
        ...style,
      }}
    >
      {isImg ? (
        <img src={src} alt={name} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : (
        (name || '?').slice(0, 1)
      )}
      {online !== undefined && <span className={online ? 'dot on' : 'dot'} />}
    </div>
  );
}
