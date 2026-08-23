import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { 
  FiEye, FiHeart, FiMessageCircle, 
  FiPlus, FiCalendar, FiUser, FiVideo, FiLock
} from "react-icons/fi";

export default function Home() {
  const [reels, setReels] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);

  const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  // Функция для получения изображения через прокси
  const getProxiedImage = (url) => {
    if (!url) return null;
    if (url.includes('cdninstagram.com') || url.includes('instagram.com') || url.includes('fbcdn.net')) {
      return `${API}/proxy-image?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  const extractUsername = (input) => {
    let result = input.trim();
    if (result.includes("instagram.com")) {
      try {
        const url = new URL(result);
        const parts = url.pathname.split("/").filter((p) => p);
        if (parts.length > 0) result = parts[0];
      } catch {}
    }
    return result.replace(/^@/, "");
  };

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [reelsRes, statsRes, usersRes] = await Promise.all([
        axios.get(API + "/reels"),
        axios.get(API + "/stats"),
        axios.get(API + "/users").catch(() => ({ data: [] })),
      ]);
      setReels(reelsRes.data);
      setStats(statsRes.data);
      setUsers(usersRes.data || []);
    } catch (e) {
      console.error(e);
      setError("Ошибка загрузки данных");
    }
    setLoading(false);
  };

  const syncUser = async () => {
    const user = extractUsername(username);
    if (!user) {
      setError("Введите username или ссылку на Instagram");
      return;
    }
    setSyncing(true);
    setError("");
    try {
      const response = await axios.post(API + "/sync/" + user);
      await loadData();
      setUsername("");
      alert(`✅ Синхронизировано: ${response.data.synced} видео`);
    } catch (e) {
      const msg = e.response?.data?.error || e.message;
      setError(msg);
      alert("❌ Ошибка: " + msg);
    }
    setSyncing(false);
  };

  const deleteUser = async (name) => {
    if (!confirm("Удалить " + name + "?")) return;
    try {
      await axios.delete(API + "/user/" + name);
      await loadData();
    } catch (e) {
      alert("Ошибка удаления: " + e.message);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
        month: "short",
        year: "numeric",
      });
    } catch {
      return "Дата неизвестна";
    }
  };

  const grouped = reels.reduce((acc, reel) => {
    const key = reel.instagram_username;
    if (!acc[key]) acc[key] = [];
    acc[key].push(reel);
    return acc;
  }, {});

  const getPlaceholder = (id) => {
    return `https://picsum.photos/seed/${id || "default"}/300/534`;
  };

  const handleImageError = (e) => {
    const img = e.target;
    const id = img.dataset.id || "default";
    // Проверяем, не пробовали ли уже загрузить без прокси
    if (img.src && img.src.includes('/proxy-image')) {
      // Если через прокси не работает, пробуем напрямую
      try {
        const url = new URL(img.src);
        const originalUrl = url.searchParams.get('url');
        if (originalUrl && !originalUrl.includes('cdninstagram.com')) {
          img.src = originalUrl;
          return;
        }
      } catch {}
    }
    // Иначе ставим заглушку
    img.src = getPlaceholder(id);
  };

  const getUserInfo = (username) => {
    return users.find(u => u.instagram_username === username);
  };

  return (
    <div className="home">
      <Header />

      <div className="home-container">
        <div className="page-header">
          <h1 className="page-title">
            Аналитика <span className="highlight">видео</span>
          </h1>
          <p className="page-subtitle">
            Вставьте ссылку на Instagram или введите username
          </p>
        </div>

        <div className="search-section">
          <div className="search-container">
            <div className="search-wrapper">
              <input
                type="text"
                placeholder="Ссылка на Instagram или username..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && syncUser()}
              />
            </div>
            <button onClick={syncUser} disabled={syncing} className="search-btn">
              {syncing ? "Загрузка..." : <><FiPlus size={16} /> Добавить</>}
            </button>
          </div>
        </div>

        {error && (
          <div className="error-box">
            <FiMessageCircle size={14} /> {error}
          </div>
        )}

        {stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-number">{stats.totalUsers}</span>
              <span className="stat-label">Блогеров</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">{stats.totalReels}</span>
              <span className="stat-label">Всего видео</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">{formatViews(stats.totalViews)}</span>
              <span className="stat-label">Просмотров</span>
            </div>
            <div className="stat-card">
              <span className="stat-number">{formatViews(stats.totalLikes)}</span>
              <span className="stat-label">Лайков</span>
            </div>
          </div>
        )}

        <div className="reels-section">
          <h2 className="section-heading">
            Все <span className="highlight">видео</span>
            {!loading && reels.length > 0 && (
              <span className="count-badge">{reels.length}</span>
            )}
          </h2>

          {loading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Загрузка...</span>
            </div>
          ) : reels.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">Нет данных для отображения</p>
              <p className="empty-sub">Вставьте ссылку на Instagram или введите username</p>
            </div>
          ) : (
            Object.entries(grouped).map(([name, items]) => {
              const sortedItems = [...items].sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
              );
              const userInfo = getUserInfo(name);
              const isPrivate = userInfo?.is_private || false;

              const totalViews = items.reduce((sum, r) => sum + (r.view_count || 0), 0);
              const totalLikes = items.reduce((sum, r) => sum + (r.like_count || 0), 0);
              const totalComments = items.reduce((sum, r) => sum + (r.comment_count || 0), 0);

              return (
                <div key={name} className="user-block">
                  <div className="user-header">
                    <div className="user-avatar">
                      {items[0]?.profile_pic ? (
                        <img 
                          src={getProxiedImage(items[0].profile_pic)} 
                          alt={name}
                          crossOrigin="anonymous"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            const parent = e.target.parentElement;
                            parent.textContent = name[0].toUpperCase();
                            parent.style.display = 'flex';
                            parent.style.alignItems = 'center';
                            parent.style.justifyContent = 'center';
                          }}
                        />
                      ) : (
                        name[0].toUpperCase()
                      )}
                    </div>
                    <span className="user-name">
                      @{name}
                      {isPrivate && (
                        <FiLock size={12} style={{ marginLeft: 6, color: '#ff6b6b' }} />
                      )}
                    </span>
                    <span className="user-count">
                      <FiUser size={12} /> {formatViews(items[0]?.followers || 0)}
                    </span>
                    <span className="user-count">
                      <FiVideo size={12} /> {items.length}
                    </span>
                    <Link to={`/blogger/${name}`} className="profile-btn">
                      Кабинет
                    </Link>
                    <button className="delete-btn" onClick={() => deleteUser(name)}>✕</button>
                  </div>

                  <div className="user-mini-stats">
                    <span><FiEye size={14} /> {formatViews(totalViews)}</span>
                    <span><FiHeart size={14} /> {formatViews(totalLikes)}</span>
                    <span><FiMessageCircle size={14} /> {formatViews(totalComments)}</span>
                  </div>

                  <div className="reels-grid">
                    {sortedItems.slice(0, 6).map((reel) => {
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
                              {caption.slice(0, 60)}
                              {caption.length > 60 && "..."}
                            </p>
                            <p className="reel-meta">
                              <FiCalendar size={12} /> {date}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}