import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { 
  FiEye, FiHeart, FiMessageCircle, FiArrowLeft, 
  FiUser, FiVideo, FiBarChart2, FiCalendar, FiLock
} from "react-icons/fi";

export default function BloggerProfile() {
  const { username } = useParams();
  const [reels, setReels] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState(null);
  const [avatarError, setAvatarError] = useState(false);

  const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  // Функция для получения изображения через прокси
  const getProxiedImage = (url) => {
    if (!url) return null;
    if (url.includes('cdninstagram.com') || url.includes('instagram.com') || url.includes('fbcdn.net')) {
      return `${API}/proxy-image?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      setAvatarError(false);
      
      try {
        const reelsRes = await axios.get(API + "/reels");
        const allReels = reelsRes.data;
        
        const userReels = allReels.filter(r => r.instagram_username === username);
        setReels(userReels);
        
        let userData = null;
        
        if (userReels.length > 0) {
          userData = {
            username: userReels[0].instagram_username,
            profile_pic: userReels[0].profile_pic,
            followers: userReels[0].followers || 0,
            is_private: userReels[0].is_private || false,
          };
        } else {
          try {
            const usersRes = await axios.get(API + "/users");
            const foundUser = usersRes.data.find(u => u.instagram_username === username);
            if (foundUser) {
              userData = {
                username: foundUser.instagram_username,
                profile_pic: foundUser.profile_pic,
                followers: foundUser.followers || 0,
                is_private: foundUser.is_private || false,
              };
            }
          } catch (e) {
            console.error("Ошибка получения пользователей:", e);
          }
        }
        
        if (userData) {
          setUser(userData);
          setIsPrivate(userData.is_private || false);
        }
        
        if (userReels.length > 0) {
          const totalViews = userReels.reduce((sum, r) => sum + (r.view_count || 0), 0);
          const totalLikes = userReels.reduce((sum, r) => sum + (r.like_count || 0), 0);
          const totalComments = userReels.reduce((sum, r) => sum + (r.comment_count || 0), 0);
          const avgViews = userReels.length > 0 ? Math.round(totalViews / userReels.length) : 0;
          
          setStats({ totalViews, totalLikes, totalComments, avgViews });
        }
        
      } catch (e) {
        console.error("Ошибка загрузки:", e);
        setError("Не удалось загрузить данные профиля");
      }
      setLoading(false);
    };
    loadData();
  }, [username]);

  const formatViews = (num) => {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
    if (num >= 1000) return (num / 1000).toFixed(1) + "K";
    return num.toString();
  };

  const formatDate = (d) => {
    if (!d) return "Дата неизвестна";
    try {
      return new Date(d).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "Дата неизвестна";
    }
  };

  const getPlaceholder = (id) => {
    return `https://picsum.photos/seed/${id || "default"}/300/534`;
  };

  const handleImageError = (e) => {
    const img = e.target;
    const id = img.dataset.id || "default";
    img.src = getPlaceholder(id);
  };

  const handleAvatarError = (e) => {
    setAvatarError(true);
    e.target.style.display = 'none';
    const parent = e.target.parentElement;
    const span = parent.querySelector('span');
    if (span) {
      span.style.display = 'flex';
    }
  };

  if (loading) {
    return (
      <div className="home">
        <Header />
        <div className="home-container">
          <div className="loading-state">
            <div className="spinner" />
            <span>Загрузка профиля...</span>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="home">
        <Header />
        <div className="home-container">
          <div className="error-box">
            <p>{error}</p>
            <Link to="/" className="back-link">
              <FiArrowLeft size={18} /> Вернуться назад
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="home">
      <Header />

      <div className="home-container">
        <Link to="/" className="back-link">
          <FiArrowLeft size={18} /> Назад
        </Link>

        {user && (
          <div className="profile-header">
            <div className="profile-avatar-wrapper">
              <div className="profile-avatar-large">
                {user.profile_pic && !avatarError ? (
                  <img 
                    src={getProxiedImage(user.profile_pic)} 
                    alt={user.username}
                    onError={handleAvatarError}
                    loading="lazy"
                    crossOrigin="anonymous"
                  />
                ) : null}
                <span style={{ display: (user.profile_pic && !avatarError) ? 'none' : 'flex' }}>
                  {user.username?.[0]?.toUpperCase() || '?'}
                </span>
              </div>
            </div>
            <div className="profile-info">
              <h1>
                @{user.username}
                {isPrivate && (
                  <span className="private-badge">
                    <FiLock size={14} /> Приватный
                  </span>
                )}
              </h1>
              <div className="profile-stats">
                <span>
                  <FiUser size={16} /> {formatViews(user.followers)} подписчиков
                </span>
                <span>
                  <FiVideo size={16} /> {reels.length} видео
                </span>
              </div>
            </div>
          </div>
        )}

        {stats && (
          <div className="profile-analytics">
            <h2><FiBarChart2 size={20} /> Аналитика профиля</h2>
            <div className="analytics-grid">
              <div className="analytics-card">
                <span className="analytics-number">{formatViews(stats.totalViews)}</span>
                <span className="analytics-label">Всего просмотров</span>
              </div>
              <div className="analytics-card">
                <span className="analytics-number">{formatViews(stats.totalLikes)}</span>
                <span className="analytics-label">Всего лайков</span>
              </div>
              <div className="analytics-card">
                <span className="analytics-number">{formatViews(stats.totalComments)}</span>
                <span className="analytics-label">Всего комментариев</span>
              </div>
              <div className="analytics-card highlight-card">
                <span className="analytics-number">{formatViews(stats.avgViews)}</span>
                <span className="analytics-label">Средний охват</span>
              </div>
            </div>
          </div>
        )}

        <div className="reels-section">
          <h2 className="section-heading">
            Все <span className="highlight">видео</span>
            <span className="count-badge">{reels.length}</span>
          </h2>

          {reels.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">😅 Нет видео</p>
              <p className="empty-sub">У этого блоггера пока нет видео</p>
              {isPrivate && (
                <p className="empty-sub" style={{ color: '#ff6b6b' }}>
                  🔒 Аккаунт приватный, показаны демо-данные
                </p>
              )}
            </div>
          ) : (
            <div className="reels-grid">
              {[...reels]
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .map((reel) => {
                  // ===== ОБЛОЖКА =====
                  let imageUrl;
                  if (reel.thumbnail_url && reel.thumbnail_url.length > 0) {
                    imageUrl = getProxiedImage(reel.thumbnail_url);
                  } else {
                    imageUrl = getPlaceholder(reel.id);
                  }
                  
                  if (!imageUrl) {
                    imageUrl = getPlaceholder(reel.id);
                  }

                  // ===== ОПИСАНИЕ =====
                  const caption = reel.caption || "Без описания";
                  
                  // ===== ДАТА =====
                  const date = formatDate(reel.timestamp);
                  
                  return (
                    <div key={reel.id} className="reel-card">
                      <div className="reel-thumb">
                        <img
                          src={imageUrl}
                          alt={caption}
                          data-id={reel.id}
                          onError={handleImageError}
                          loading="lazy"
                          crossOrigin="anonymous"
                        />
                        <div className="reel-overlay">
                          <span>
                            <FiEye size={14} /> {formatViews(reel.view_count)}
                          </span>
                          <span>
                            <FiHeart size={14} /> {formatViews(reel.like_count)}
                          </span>
                          <span>
                            <FiMessageCircle size={14} /> {reel.comment_count || 0}
                          </span>
                        </div>
                      </div>
                      <div className="reel-info">
                        <p className="reel-caption">
                          {caption.slice(0, 80)}
                          {caption.length > 80 && "..."}
                        </p>
                        <p className="reel-meta">
                          <FiCalendar size={12} /> {date}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}