const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { ApifyClient } = require('apify-client');
require('dotenv').config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        instagram_username VARCHAR(255) UNIQUE,
        username VARCHAR(255),
        profile_pic TEXT,
        followers INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reels (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        instagram_id VARCHAR(255) UNIQUE,
        media_url TEXT,
        thumbnail_url TEXT,
        caption TEXT,
        view_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ База данных готова');
  } catch (err) {
    console.error('❌ Ошибка инициализации БД:', err.message);
  }
}
initDB();

app.get('/api/reels', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.instagram_username, u.profile_pic, u.followers
      FROM reels r 
      JOIN users u ON r.user_id = u.id 
      ORDER BY r.timestamp DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/:username', async (req, res) => {
  const { username } = req.params;
  console.log(`🔍 Синхронизация: ${username}`);

  try {
    // 1. Получаем профиль
    console.log('📡 Получаем профиль через Apify...');
    const profileRun = await apifyClient.actor('apify/instagram-profile-scraper').call({
      usernames: [username],
    });
    const { items: profileItems } = await apifyClient.dataset(profileRun.defaultDatasetId).listItems();
    const profile = profileItems[0];

    if (!profile) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    console.log(`✅ Найден профиль: ${profile.username}, подписчиков: ${profile.followersCount || 0}`);

    // Сохраняем пользователя
    let userResult = await pool.query(
      `SELECT id FROM users WHERE instagram_username = $1`,
      [username]
    );

    let userId;
    if (userResult.rows.length === 0) {
      const newUser = await pool.query(
        `INSERT INTO users (instagram_username, username, profile_pic, followers) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id`,
        [
          username,
          profile.username || username,
          profile.profilePicUrl || profile.avatar || '',
          profile.followersCount || profile.followers || 0
        ]
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
      await pool.query(
        `UPDATE users SET 
          username = $1,
          profile_pic = $2,
          followers = $3
        WHERE id = $4`,
        [
          profile.username || username,
          profile.profilePicUrl || profile.avatar || '',
          profile.followersCount || profile.followers || 0,
          userId
        ]
      );
    }

    // 2. Получаем посты - ИСПРАВЛЕННАЯ ВЕРСИЯ
    console.log('📡 Получаем посты через Instagram Scraper...');
    
    // Пробуем разные варианты акторов
    let postsItems = [];
    let actorUsed = '';
    
    try {
      // Вариант 1: instagram-post-scraper (рекомендуется для постов)
      console.log('🔄 Пробуем instagram-post-scraper...');
      const postsRun = await apifyClient.actor('apify/instagram-post-scraper').call({
        usernames: [username],
        resultsLimit: 30,
        resultsType: 'posts', // Явно указываем тип
      });
      
      const { items } = await apifyClient.dataset(postsRun.defaultDatasetId).listItems();
      postsItems = items;
      actorUsed = 'instagram-post-scraper';
      console.log(`📹 Найдено постов через post-scraper: ${postsItems.length}`);
    } catch (err) {
      console.log('❌ instagram-post-scraper не сработал, пробуем другой...');
      
      try {
        // Вариант 2: instagram-scraper
        console.log('🔄 Пробуем instagram-scraper...');
        const postsRun = await apifyClient.actor('apify/instagram-scraper').call({
          usernames: [username],
          resultsLimit: 30,
          maxItems: 30,
        });
        
        const { items } = await apifyClient.dataset(postsRun.defaultDatasetId).listItems();
        postsItems = items;
        actorUsed = 'instagram-scraper';
        console.log(`📹 Найдено постов через scraper: ${postsItems.length}`);
      } catch (err2) {
        console.log('❌ instagram-scraper не сработал, пробуем последний вариант...');
        
        try {
          // Вариант 3: direct-scraper
          const postsRun = await apifyClient.actor('lukas/instagram-scraper').call({
            usernames: [username],
            resultsLimit: 30,
          });
          
          const { items } = await apifyClient.dataset(postsRun.defaultDatasetId).listItems();
          postsItems = items;
          actorUsed = 'lukas/instagram-scraper';
          console.log(`📹 Найдено постов через lukas-scraper: ${postsItems.length}`);
        } catch (err3) {
          console.log('❌ Все акторы не сработали');
        }
      }
    }

    console.log(`📹 Найдено постов: ${postsItems.length}`);
    
    // Логируем первый пост для отладки
    if (postsItems.length > 0) {
      console.log('📦 Пример поста:', JSON.stringify(postsItems[0], null, 2));
    }

    // Фильтруем видео
    const videoPosts = postsItems.filter(post => {
      // Проверяем разные поля, которые могут указывать на видео
      const isVideo = 
        post.type === 'Video' || 
        post.type === 'video' ||
        post.mediaType === 'Video' ||
        post.mediaType === 'video' ||
        post.videoUrl || 
        post.video || 
        post.video_url ||
        post.isVideo === true ||
        post.is_video === true ||
        (post.media_type === 2) || // Instagram API: 2 = video
        (post.media_type === 8) || // Instagram API: 8 = carousel with video
        (post.video_versions && post.video_versions.length > 0) ||
        (post.video_play_count !== undefined);
      
      return isVideo;
    });
    
    console.log(`🎥 Найдено видео: ${videoPosts.length}`);

    // Если видео не найдены, но есть посты, пробуем получить их напрямую
    if (videoPosts.length === 0 && postsItems.length > 0) {
      console.log('⚠️ Видео не найдены, но есть посты. Проверяем каждый пост...');
      
      for (const post of postsItems) {
        console.log(`📝 Пост ${post.id || 'unknown'}:`, {
          type: post.type || post.mediaType || post.media_type,
          hasVideo: !!post.videoUrl || !!post.video || !!post.video_url,
          isVideo: post.isVideo || post.is_video
        });
      }
    }

    // Удаляем старые рилсы
    await pool.query(`DELETE FROM reels WHERE user_id = $1`, [userId]);

    let synced = 0;
    
    // Если видео не найдены, но есть посты, пробуем сохранить все посты
    const postsToSave = videoPosts.length > 0 ? videoPosts : postsItems;

    for (const post of postsToSave) {
      if (!post.id) continue;

      // Извлекаем данные из разных полей
      const thumbnail = 
        post.displayUrl || 
        post.display_url || 
        post.thumbnailUrl || 
        post.thumbnail_url || 
        post.thumbnail || 
        post.cover || 
        post.imageUrl ||
        post.image_url ||
        '';

      const videoUrl = 
        post.videoUrl || 
        post.video_url || 
        post.video || 
        post.video_versions?.[0]?.url ||
        '';

      let caption = '';
      if (post.caption) {
        if (typeof post.caption === 'string') caption = post.caption;
        else if (typeof post.caption === 'object' && post.caption.text) caption = post.caption.text;
      } else if (post.text) {
        caption = post.text;
      } else if (post.description) {
        caption = post.description;
      }

      const views = 
        post.videoViews || 
        post.video_play_count || 
        post.videoPlayCount || 
        post.playCount || 
        post.view_count || 
        post.views || 
        0;

      const likes = 
        post.likesCount || 
        post.like_count || 
        post.likes || 
        0;

      const comments = 
        post.commentsCount || 
        post.comment_count || 
        post.comments || 
        0;

      let timestamp = new Date();
      if (post.timestamp) {
        timestamp = new Date(post.timestamp);
      } else if (post.createdAt) {
        timestamp = new Date(post.createdAt);
      } else if (post.takenAtTimestamp) {
        timestamp = new Date(post.takenAtTimestamp * 1000);
      } else if (post.date) {
        timestamp = new Date(post.date);
      }

      await pool.query(
        `INSERT INTO reels (
          user_id, instagram_id, media_url, thumbnail_url, 
          caption, view_count, like_count, comment_count, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          post.id || `post_${Date.now()}_${synced}`,
          videoUrl,
          thumbnail,
          caption ? caption.slice(0, 500) : '',
          parseInt(views) || 0,
          parseInt(likes) || 0,
          parseInt(comments) || 0,
          timestamp
        ]
      );
      synced++;
    }

    console.log(`✅ Синхронизировано: ${synced} постов (из них видео: ${videoPosts.length})`);

    const reelsData = await pool.query(
      `SELECT r.*, u.instagram_username, u.profile_pic, u.followers
       FROM reels r 
       JOIN users u ON r.user_id = u.id 
       WHERE u.instagram_username = $1
       ORDER BY r.timestamp DESC`,
      [username]
    );

    res.json({
      success: true,
      synced,
      user: {
        username: profile.username,
        followers: profile.followersCount || 0,
        profile_pic: profile.profilePicUrl || profile.avatar || ''
      },
      reels: reelsData.rows,
      debug: {
        actorUsed,
        totalPosts: postsItems.length,
        videoFound: videoPosts.length
      }
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM reels');
    const views = await pool.query('SELECT SUM(view_count) FROM reels');
    const likes = await pool.query('SELECT SUM(like_count) FROM reels');
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const top = await pool.query(`
      SELECT r.caption, r.view_count, r.thumbnail_url, u.instagram_username
      FROM reels r 
      JOIN users u ON r.user_id = u.id 
      ORDER BY r.view_count DESC 
      LIMIT 5
    `);
    res.json({
      totalReels: parseInt(total.rows[0].count || 0),
      totalViews: parseInt(views.rows[0].sum || 0),
      totalLikes: parseInt(likes.rows[0].sum || 0),
      totalUsers: parseInt(users.rows[0].count || 0),
      topReels: top.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/user/:username', async (req, res) => {
  const { username } = req.params;
  try {
    await pool.query('DELETE FROM reels WHERE user_id = (SELECT id FROM users WHERE instagram_username = $1)', [username]);
    await pool.query('DELETE FROM users WHERE instagram_username = $1', [username]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📊 Apify токен: ${APIFY_TOKEN ? '✅' : '❌'}`);
});