export function ProfileAvatar({ image, name, size = 42 }: { image?: string | null; name: string; size?: number }) {
  return image ? <img className="profile-avatar" src={image} alt="" width={size} height={size} />
    : <span className="profile-avatar profile-avatar-fallback" aria-hidden="true" style={{ width: size, height: size }}>{name[0]?.toUpperCase() ?? '?'}</span>;
}
