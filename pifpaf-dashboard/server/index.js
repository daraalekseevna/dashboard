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
    console.log('📡 Получаем профиль через Apify...');
    const profileRun = await apifyClient.actor('apify/instagram-profile-scraper').call({
      usernames: [username],
    });
    const { items: profileItems } = await apifyClient.dataset(profileRun.defaultDatasetId).listItems();
    const profile = profileItems[0];

    if (!profile) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    console.log(`✅ Найден профиль: ${profile.username}, подписчиков: ${profile.followers || 0}`);

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
        [username, profile.username, profile.avatar || '', profile.followers || 0]
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
        [profile.username, profile.avatar || '', profile.followers || 0, userId]
      );
    }

    console.log('📡 Получаем рилсы через apify/instagram-post-scraper...');
    const reelsRun = await apifyClient.actor('apify/instagram-post-scraper').call({
      usernames: [username],
      resultsLimit: 20,
    });
    const { items: reelsItems } = await apifyClient.dataset(reelsRun.defaultDatasetId).listItems();

    console.log(`📹 Найдено рилсов: ${reelsItems.length}`);

    reelsItems.sort((a, b) => {
      const dateA = a.taken_at_timestamp || a.timestamp || a.createdAt || a.date || 0;
      const dateB = b.taken_at_timestamp || b.timestamp || b.createdAt || b.date || 0;
      return new Date(dateB) - new Date(dateA);
    });

    await pool.query(`DELETE FROM reels WHERE user_id = $1`, [userId]);

    let synced = 0;
    if (reelsItems && reelsItems.length > 0) {
      for (const reel of reelsItems) {
        if (!reel.id) continue;

        // ===== ОБЛОЖКА =====
        const thumbnail = reel.display_url || reel.thumbnail_url || '';
        
        // ===== ВИДЕО =====
        const videoUrl = reel.video_url || '';
        
        // ===== ОПИСАНИЕ =====
        let caption = '';
        if (reel.caption) {
          if (typeof reel.caption === 'string') caption = reel.caption;
          else if (typeof reel.caption === 'object' && reel.caption.text) caption = reel.caption.text;
          else if (Array.isArray(reel.caption) && reel.caption.length > 0) {
            caption = reel.caption[0]?.text || '';
          } else caption = String(reel.caption) || '';
        } else if (reel.text) {
          caption = reel.text;
        } else if (reel.description) {
          caption = reel.description;
        }
        const captionText = typeof caption === 'string' ? caption.slice(0, 500) : String(caption).slice(0, 500);

        // ===== ПРОСМОТРЫ, ЛАЙКИ, КОММЕНТАРИИ =====
        const views = reel.video_play_count || reel.play_count || reel.view_count || 0;
        const likes = reel.like_count || reel.likes || 0;
        const comments = reel.comment_count || reel.comments || 0;

        // ===== ДАТА =====
        let timestamp = new Date();
        if (reel.taken_at_timestamp) {
          timestamp = new Date(reel.taken_at_timestamp * 1000);
        } else if (reel.timestamp) {
          timestamp = new Date(reel.timestamp);
        } else if (reel.createdAt) {
          timestamp = new Date(reel.createdAt);
        } else if (reel.date) {
          timestamp = new Date(reel.date);
        }

        console.log(`📹 Рилс ${synced + 1}: обложка=${thumbnail ? '✅' : '❌'}, дата=${timestamp.toISOString()}`);

        await pool.query(
          `INSERT INTO reels (
            user_id, instagram_id, media_url, thumbnail_url, 
            caption, view_count, like_count, comment_count, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            userId,
            reel.id,
            videoUrl,
            thumbnail,
            captionText,
            views,
            likes,
            comments,
            timestamp
          ]
        );
        synced++;
      }
    }

    console.log(`✅ Синхронизировано: ${synced} рилсов`);

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
        followers: profile.followers || 0,
        profile_pic: profile.avatar
      },
      reels: reelsData.rows
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
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