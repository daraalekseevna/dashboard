import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { 
  FiEye, FiHeart, FiMessageCircle, FiArrowLeft, 
  FiUser, FiVideo, FiBarChart2, FiCalendar 
} from "react-icons/fi";

export default function BloggerProfile() {
  const { username } = useParams();
  const [reels, setReels] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);

  const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const reelsRes = await axios.get(API + "/reels");
        const allReels = reelsRes.data;
        const userReels = allReels.filter(r => r.instagram_username === username);
        setReels(userReels);
        
        if (userReels.length > 0) {
          setUser({
            username: userReels[0].instagram_username,
            profile_pic: userReels[0].profile_pic,
            followers: userReels[0].followers || 0,
          });
          
          const totalViews = userReels.reduce((sum, r) => sum + (r.view_count || 0), 0);
          const totalLikes = userReels.reduce((sum, r) => sum + (r.like_count || 0), 0);
          const totalComments = userReels.reduce((sum, r) => sum + (r.comment_count || 0), 0);
          const avgViews = userReels.length > 0 ? Math.round(totalViews / userReels.length) : 0;
          
          setStats({ totalViews, totalLikes, totalComments, avgViews });
        }
      } catch (e) {
        console.error(e);
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

  return (
    <div className="home">
      <Header />

      <div className="home-container">
        <Link to="/" className="back-link">
          <FiArrowLeft size={18} /> Назад к дашборду
        </Link>

        {user && (
          <div className="profile-header">
            <div className="profile-avatar-large">
              {user.profile_pic ? (
                <img src={user.profile_pic} alt="" />
              ) : (
                <span>{user.username?.[0]?.toUpperCase()}</span>
              )}
            </div>
            <div className="profile-info">
              <h1>@{user.username}</h1>
              <div className="profile-stats">
                <span><FiUser size={14} /> {formatViews(user.followers)} подписчиков</span>
                <span><FiVideo size={14} /> {reels.length} рилсов</span>
              </div>
            </div>
          </div>
        )}

        {stats && (
          <div className="profile-analytics">
            <h2><FiBarChart2 size={20} /> Аналитика профиля</h2>
            <div className="analytics-grid">
              <div className="analytics-card">
                <span className="analytics-icon"><FiEye size={22} /></span>
                <span className="analytics-number">{formatViews(stats.totalViews)}</span>
                <span className="analytics-label">Всего просмотров</span>
              </div>
              <div className="analytics-card">
                <span className="analytics-icon"><FiHeart size={22} /></span>
                <span className="analytics-number">{formatViews(stats.totalLikes)}</span>
                <span className="analytics-label">Всего лайков</span>
              </div>
              <div className="analytics-card">
                <span className="analytics-icon"><FiMessageCircle size={22} /></span>
                <span className="analytics-number">{formatViews(stats.totalComments)}</span>
                <span className="analytics-label">Всего комментариев</span>
              </div>
              <div className="analytics-card highlight-card">
                <span className="analytics-icon"><FiBarChart2 size={22} /></span>
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
              <p className="empty-title">😅 Нет рилсов</p>
              <p className="empty-sub">У этого блоггера пока нет видео</p>
            </div>
          ) : (
            <div className="reels-grid">
              {[...reels]
                .sort((a, b) => {
                  const dateA = new Date(a.timestamp);
                  const dateB = new Date(b.timestamp);
                  return dateA - dateB; // старые сверху (20), новые снизу (1)
                })
                .map((reel) => (
                  <div key={reel.id} className="reel-card">
                    <div className="reel-thumb">
                      <img
                        src={reel.thumbnail_url || getPlaceholder(reel.id)}
                        alt=""
                        onError={(e) => {
                          e.target.src = getPlaceholder(reel.id);
                        }}
                      />
                      <div className="reel-overlay">
                        <span>
                          <FiEye size={13} /> {formatViews(reel.view_count)}
                        </span>
                        <span>
                          <FiHeart size={13} /> {formatViews(reel.like_count)}
                        </span>
                        <span>
                          <FiMessageCircle size={13} /> {reel.comment_count || 0}
                        </span>
                      </div>
                    </div>
                    <div className="reel-info">
                      <p className="reel-caption">
                        {reel.caption?.slice(0, 60) || "Без описания"}
                      </p>
                      <p className="reel-meta">
                        <FiCalendar size={12} /> {formatDate(reel.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}