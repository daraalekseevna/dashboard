import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { 
  FiEye, FiHeart, FiMessageCircle, 
  FiPlus, FiCalendar
} from "react-icons/fi";

export default function Home() {
  const [reels, setReels] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [floatingIcons, setFloatingIcons] = useState([]);
  const iconTimerRef = useRef(null);

  const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

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
      const [reelsRes, statsRes] = await Promise.all([
        axios.get(API + "/reels"),
        axios.get(API + "/stats"),
      ]);
      setReels(reelsRes.data);
      setStats(statsRes.data);
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
      alert(`✅ Синхронизировано: ${response.data.synced} рилсов`);
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

  // ===== ГЕНЕРАЦИЯ ВСПЛЫВАЮЩИХ ИКОНОК =====
  useEffect(() => {
    if (reels.length === 0 && !loading) {
      const iconTypes = [
        { Icon: FiEye, label: "10K", color: "#3b5eff" },
        { Icon: FiHeart, label: "45K", color: "#3b5eff" },
        { Icon: FiEye, label: "25K", color: "#5e7dff" },
        { Icon: FiHeart, label: "12K", color: "#2e4deb" },
        { Icon: FiEye, label: "8K", color: "#3b5eff" },
        { Icon: FiHeart, label: "32K", color: "#5e7dff" },
        { Icon: FiEye, label: "15K", color: "#2e4deb" },
        { Icon: FiHeart, label: "60K", color: "#3b5eff" },
      ];

      const positions = [
        { x: 10, y: 25 }, { x: 25, y: 50 }, { x: 40, y: 15 },
        { x: 55, y: 65 }, { x: 70, y: 20 }, { x: 85, y: 45 },
        { x: 15, y: 70 }, { x: 45, y: 35 }, { x: 60, y: 10 },
        { x: 80, y: 55 }, { x: 30, y: 80 }, { x: 50, y: 25 },
      ];

      const shuffled = [...positions].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 8);

      const icons = selected.map((pos, index) => {
        const type = iconTypes[index % iconTypes.length];
        return {
          id: `icon-${Date.now()}-${index}`,
          Icon: type.Icon,
          label: type.label,
          color: type.color,
          x: pos.x,
          y: pos.y,
          duration: 4 + Math.random() * 2,
          delay: Math.random() * 0.5,
          xOffset: (Math.random() - 0.5) * 15,
          isActive: true,
        };
      });

      setFloatingIcons(icons);

      let counter = 0;
      const addNewIcon = () => {
        if (reels.length > 0 || loading) return;
        const type = iconTypes[counter % iconTypes.length];
        const pos = positions[counter % positions.length];
        const newIcon = {
          id: `icon-${Date.now()}-${counter}`,
          Icon: type.Icon,
          label: type.label,
          color: type.color,
          x: pos.x,
          y: pos.y,
          duration: 4 + Math.random() * 2,
          delay: 0,
          xOffset: (Math.random() - 0.5) * 15,
          isActive: true,
        };
        setFloatingIcons((prev) => {
          const filtered = prev.filter((icon) => icon.isActive);
          return [...filtered, newIcon].slice(-12);
        });
        setTimeout(() => {
          setFloatingIcons((prev) =>
            prev.map((icon) =>
              icon.id === newIcon.id ? { ...icon, isActive: false } : icon
            )
          );
        }, (4 + Math.random() * 2) * 1000 + 500);
        counter++;
        const interval = 1500 + Math.random() * 1500;
        iconTimerRef.current = setTimeout(addNewIcon, interval);
      };

      addNewIcon();
      return () => {
        if (iconTimerRef.current) clearTimeout(iconTimerRef.current);
      };
    } else {
      setFloatingIcons([]);
      if (iconTimerRef.current) clearTimeout(iconTimerRef.current);
    }
  }, [reels, loading]);

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

  const getPlaceholder = (id, size) => {
    const w = size === "thumb" ? 44 : 300;
    const h = size === "thumb" ? 44 : 534;
    return `https://picsum.photos/seed/${id || "default"}/${w}/${h}`;
  };

  const getMediaUrl = (url) => {
    if (!url) return null;
    if (url.includes("cdninstagram.com") || url.includes("instagram.com")) {
      return `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
    }
    return url;
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
              <div className="empty-chart">{/* SVG графика */}</div>
              <p className="empty-title">Нет данных для отображения</p>
              <p className="empty-sub">Вставьте ссылку на Instagram или введите username</p>
            </div>
          ) : (
            Object.entries(grouped).map(([name, items]) => {
              const reversedItems = [...items].reverse();

              const totalViews = items.reduce((sum, r) => sum + (r.view_count || 0), 0);
              const totalLikes = items.reduce((sum, r) => sum + (r.like_count || 0), 0);
              const totalComments = items.reduce((sum, r) => sum + (r.comment_count || 0), 0);

              return (
                <div key={name} className="user-block">
                  <div className="user-header">
                    <div className="user-avatar">{name[0].toUpperCase()}</div>
                    <span className="user-name">@{name}</span>
                    <span className="user-count">
                      {formatViews(items[0]?.followers || 0)} подписчиков
                    </span>
                    <span className="user-count">
                      {items.length} видео
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
                    {reversedItems.map((reel) => {
                      const views = reel.view_count || 0;
                      const likes = reel.like_count || 0;
                      const comments = reel.comment_count || 0;
                      const caption = reel.caption || "Без описания";
                      const imageUrl = getMediaUrl(reel.thumbnail_url || reel.media_url) || getPlaceholder(reel.id, "card");

                      return (
                        <div key={reel.id} className="reel-card">
                          <div className="reel-thumb">
                            <img
                              src={imageUrl}
                              alt=""
                              onError={(e) => {
                                e.target.src = getPlaceholder(reel.id, "card");
                              }}
                            />
                            <div className="reel-overlay">
                              <span>
                                <FiEye size={14} /> {formatViews(views)}
                              </span>
                              <span>
                                <FiHeart size={14} /> {formatViews(likes)}
                              </span>
                              <span>
                                <FiMessageCircle size={14} /> {comments}
                              </span>
                            </div>
                          </div>
                          <div className="reel-info">
                            <p className="reel-caption">
                              {caption.slice(0, 60)}
                            </p>
                            <p className="reel-meta">
                              <FiCalendar size={12} /> {formatDate(reel.timestamp)} • <FiMessageCircle size={12} /> {comments}
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