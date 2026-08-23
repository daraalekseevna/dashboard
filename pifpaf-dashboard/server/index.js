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

// Получение всех рилсов
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

// Синхронизация пользователя
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

    // 2. Сохраняем/обновляем пользователя
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

    // 3. Получаем посты (рилсы)
    console.log('📡 Получаем посты через apify/instagram-scraper...');
    const postsRun = await apifyClient.actor('apify/instagram-scraper').call({
      usernames: [username],
      resultsLimit: 30,
    });
    const { items: postsItems } = await apifyClient.dataset(postsRun.defaultDatasetId).listItems();

    console.log(`📹 Найдено постов: ${postsItems.length}`);

    // Фильтруем только видео
    const videoPosts = postsItems.filter(post => post.type === 'Video' || post.videoUrl || post.video);
    
    console.log(`🎥 Найдено видео: ${videoPosts.length}`);

    // Удаляем старые рилсы
    await pool.query(`DELETE FROM reels WHERE user_id = $1`, [userId]);

    let synced = 0;
    for (const post of videoPosts) {
      if (!post.id) continue;

      // Извлекаем данные
      const thumbnail = post.displayUrl || post.thumbnailUrl || post.thumbnail || '';
      const videoUrl = post.videoUrl || post.video || '';
      
      let caption = '';
      if (post.caption) {
        if (typeof post.caption === 'string') caption = post.caption;
        else if (typeof post.caption === 'object' && post.caption.text) caption = post.caption.text;
      }

      const views = post.videoViews || post.videoPlayCount || post.playCount || 0;
      const likes = post.likesCount || post.likes || 0;
      const comments = post.commentsCount || post.comments || 0;

      let timestamp = new Date();
      if (post.timestamp) {
        timestamp = new Date(post.timestamp);
      } else if (post.createdAt) {
        timestamp = new Date(post.createdAt);
      } else if (post.takenAtTimestamp) {
        timestamp = new Date(post.takenAtTimestamp * 1000);
      }

      await pool.query(
        `INSERT INTO reels (
          user_id, instagram_id, media_url, thumbnail_url, 
          caption, view_count, like_count, comment_count, timestamp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          userId,
          post.id,
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

    console.log(`✅ Синхронизировано: ${synced} видео`);

    // Получаем обновленные данные
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
      reels: reelsData.rows
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Статистика
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

// Удаление пользователя
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📊 Apify токен: ${APIFY_TOKEN ? '✅' : '❌'}`);
});