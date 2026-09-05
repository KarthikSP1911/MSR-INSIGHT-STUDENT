"use client";

import React, { useState } from "react";
import Image from "next/image";
import { LogOut } from "lucide-react";

interface SidebarProfileProps {
  user: {
    name?: string | null;
    profileImage?: string | null;
    usn?: string | null;
  } | null;
  onLogout: () => void;
  avatarSeedSuffix?: string;
  onAvatarChange?: (e: React.MouseEvent) => void;
}

const SidebarProfile: React.FC<SidebarProfileProps> = ({ user, onLogout, avatarSeedSuffix = "", onAvatarChange }) => {
  const [imgError, setImgError] = useState(false);

  if (!user) {
    return (
      <div className="sidebar-profile-skeleton">
        <div className="skeleton-avatar"></div>
        <div className="skeleton-info">
          <div className="skeleton-line"></div>
          <div className="skeleton-line short"></div>
        </div>
      </div>
    );
  }

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .substring(0, 2)
    : "ST";

  return (
    <div className="sidebar-profile-section">
      <div className="profile-card">
        <div className="profile-image-container" onClick={onAvatarChange} style={{ cursor: onAvatarChange ? "pointer" : "default" }} title={onAvatarChange ? "Click to change avatar" : undefined}>
          {user.usn && !imgError ? (
            <img 
              src={`https://api.dicebear.com/10.x/bottts-neutral/svg?seed=${encodeURIComponent(user.usn + avatarSeedSuffix)}`} 
              alt={user.name ?? "Student"} 
              width={40} 
              height={40} 
              className="profile-avatar" 
              onError={() => setImgError(true)}
            />
          ) : user.profileImage ? (
            <Image src={user.profileImage} alt={user.name ?? "Student"} width={40} height={40} className="profile-avatar" />
          ) : (
            <div className="profile-initials-avatar">{initials}</div>
          )}
        </div>
        <div className="profile-details">
          <span className="profile-name" title={user.name ?? undefined}>
            {user.name}
          </span>
          <button onClick={onLogout} className="profile-logout-link" title="Logout">
            <LogOut size={12} />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SidebarProfile;
